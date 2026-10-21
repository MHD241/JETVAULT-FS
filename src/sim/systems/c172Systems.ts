// Cessna 172S aircraft systems: electrical, fuel, vacuum (gyros), pitot-static and the
// resulting instrument indications. Indications are derived from the simulated
// aircraft state through each instrument's physical principle (pressures, gyros,
// accelerations), so they lag, fail and err as their real counterparts do.

import { clamp, approach, RAD, DEG, KT, FT } from '../../core/math';
import { Aircraft } from '../fdm/aircraft';
import { FlightControls } from '../controls';
import { indicatedAltitude, impactPressure, casFromImpactPressure } from '../atmosphere';
import { EGPH_MAG_VAR } from '../../world/geo';

export interface Indications {
  iasKt: number;
  altitudeFt: number;
  vsiFpm: number;
  pitchDeg: number; // attitude indicator
  rollDeg: number;
  headingDeg: number; // heading indicator (DG), magnetic
  compassDeg: number;
  turnRateDegS: number; // turn coordinator
  slipBall: number; // -1..1 (positive = ball right)
  rpm: number;
  oilTempF: number;
  oilPressPsi: number;
  egtF: number;
  chtF: number;
  fuelLeftGal: number;
  fuelRightGal: number;
  fuelFlowGph: number;
  manifoldInHg: number;
  vacuumInHg: number;
  busVolts: number;
  ammeterA: number;
  oatC: number;
  stallHorn: boolean;
  lowVacuum: boolean;
  lowVolts: boolean;
  lowFuelL: boolean;
  lowFuelR: boolean;
  lowOilPress: boolean;
  gyrosValid: boolean;
  avionicsPowered: boolean;
  /** Turn coordinator 'flag' (electric gyro unpowered). */
  turnFlag: boolean;
}

const GAL = 3.78541; // L
const AVGAS = 0.72; // kg/L

export class C172Systems {
  // Electrical
  batteryCharge = 1; // 0..1
  busVolts = 0;
  batteryAmps = 0;
  alternatorOnline = false;
  // Vacuum and gyros
  vacuum = 0;
  attGyroSpin = 0; // 0..1
  dgSpin = 0;
  tcSpin = 0;
  private attPitch = 0;
  private attRoll = 0;
  private dgHeading = 0;
  // Pitot-static lags
  private vsiState = 0;
  private prevAlt = NaN;
  // Fuel
  fuelLineReserve = 0.25; // kg of fuel in lines/gascolator after selector OFF
  private massTimer = 0;
  ind: Indications;

  constructor(private ac: Aircraft, initiallyRunning: boolean) {
    if (initiallyRunning) {
      this.attGyroSpin = 1; this.dgSpin = 1; this.tcSpin = 1;
      this.busVolts = 28;
    }
    const [phi, theta, psi] = ac.euler;
    this.attPitch = theta; this.attRoll = phi;
    this.dgHeading = psi * RAD + -EGPH_MAG_VAR;
    this.ind = this.emptyIndications();
  }

  private emptyIndications(): Indications {
    return {
      iasKt: 0, altitudeFt: 0, vsiFpm: 0, pitchDeg: 0, rollDeg: 0, headingDeg: 0, compassDeg: 0,
      turnRateDegS: 0, slipBall: 0, rpm: 0, oilTempF: 0, oilPressPsi: 0, egtF: 0, chtF: 0,
      fuelLeftGal: 0, fuelRightGal: 0, fuelFlowGph: 0, manifoldInHg: 0, vacuumInHg: 0, busVolts: 0,
      ammeterA: 0, oatC: 0, stallHorn: false, lowVacuum: false, lowVolts: false, lowFuelL: false,
      lowFuelR: false, lowOilPress: false, gyrosValid: false, avionicsPowered: false, turnFlag: true,
    };
  }

  /** Fuel can reach the engine through the selected valve position. */
  fuelAvailable(c: FlightControls): boolean {
    if (c.fuelSelector === 'OFF') return this.fuelLineReserve > 0;
    const t = this.ac.def.tanks;
    const ok = (i: number) => this.ac.fuel[i] > t[i].unusable;
    if (c.fuelSelector === 'BOTH') return ok(0) || ok(1) || this.fuelLineReserve > 0;
    const i = t.findIndex((x) => x.side === c.fuelSelector);
    return ok(i) || this.fuelLineReserve > 0;
  }

  busPowered() { return this.busVolts > 18; }

  /** Electrical, fuel and vacuum update; call before the aircraft step. */
  stepSystems(dt: number, c: FlightControls) {
    const ac = this.ac;
    const eng = ac.engine;
    // --- Electrical (24 V system, 60 A alternator)
    const battV = 21 + 4.5 * this.batteryCharge; // open circuit
    this.alternatorOnline = c.masterBattery && c.masterAlternator && eng.rpm > 900;
    let load = 0; // amps
    if (c.masterBattery) {
      load += 1.5; // essential instruments, turn coordinator, annunciators
      if (c.avionics) load += 7;
      if (c.beacon) load += 2;
      if (c.navLights) load += 2.5;
      if (c.strobes) load += 3;
      if (c.taxiLight) load += 3;
      if (c.landingLight) load += 4.5;
      if (c.fuelPump) load += 2;
      if (c.pitotHeat) load += 5;
      if (Math.abs(ac.flap - ac.def.controls.flapDetents[clamp(Math.round(c.flapLever), 0, 3)]) > 0.001) load += 10;
      if (eng.starterEngaged) load += 140;
    }
    if (!c.masterBattery) {
      this.busVolts = 0; this.batteryAmps = 0;
    } else if (this.alternatorOnline) {
      this.busVolts = 28;
      const charge = clamp((1 - this.batteryCharge) * 40, 0, 20);
      this.batteryAmps = charge;
      this.batteryCharge = clamp(this.batteryCharge + (charge * dt) / 3600 / 13.6, 0, 1);
    } else {
      this.busVolts = Math.max(0, battV - load * 0.025);
      this.batteryAmps = -load;
      this.batteryCharge = clamp(this.batteryCharge - (load * dt) / 3600 / 13.6, 0, 1);
    }

    // --- Fuel: burn from the selected tanks
    const burn = eng.fuelFlow * dt;
    if (burn > 0) {
      const t = ac.def.tanks;
      const sel = c.fuelSelector;
      const usable = (i: number) => ac.fuel[i] > t[i].unusable;
      const idx = sel === 'BOTH' ? [0, 1].filter(usable) : sel === 'OFF' ? [] : [t.findIndex((x) => x.side === sel)].filter(usable);
      if (idx.length === 0) {
        this.fuelLineReserve = Math.max(0, this.fuelLineReserve - burn);
      } else {
        for (const i of idx) ac.fuel[i] = Math.max(0, ac.fuel[i] - burn / idx.length);
        this.fuelLineReserve = 0.25;
      }
    }
    this.massTimer += dt;
    if (this.massTimer > 1) { this.massTimer = 0; ac.updateMass(); }

    // --- Vacuum pump (engine driven) and gyros
    const suction = clamp((eng.rpm - 300) / 900, 0, 1) * 5.0;
    this.vacuum = approach(this.vacuum, suction, 0.5, dt);
    const vacOk = this.vacuum > 4.0;
    this.attGyroSpin = approach(this.attGyroSpin, vacOk ? 1 : 0, vacOk ? 25 : 150, dt);
    this.dgSpin = approach(this.dgSpin, vacOk ? 1 : 0, vacOk ? 25 : 150, dt);
    this.tcSpin = approach(this.tcSpin, this.busVolts > 18 ? 1 : 0, this.busVolts > 18 ? 15 : 60, dt);
  }

  /** Instrument indications after the aircraft step. */
  updateIndications(dt: number, c: FlightControls) {
    const ac = this.ac;
    const ind = this.ind;
    const eng = ac.engine;
    const [phi, theta, psi] = ac.euler;

    // Pitot-static: pitot sees ram pressure along the aircraft axis (no alpha correction)
    const vAxial = Math.max(0, ac.airVelBody.x);
    const qc = impactPressure(vAxial, ac.air);
    ind.iasKt = casFromImpactPressure(qc) / KT;
    const altM = indicatedAltitude(ac.air.pressure, c.kollsman * 100);
    ind.altitudeFt = altM / FT;
    if (Number.isNaN(this.prevAlt)) this.prevAlt = altM;
    const rate = (altM - this.prevAlt) / Math.max(dt, 1e-3);
    this.prevAlt = altM;
    this.vsiState = approach(this.vsiState, rate, 1.6, dt);
    ind.vsiFpm = clamp(this.vsiState / FT * 60, -2000, 2000);

    // Attitude indicator: erects toward true attitude when spun up; topples when not
    if (this.attGyroSpin > 0.6) {
      this.attPitch = approach(this.attPitch, theta, 0.15, dt);
      this.attRoll = approach(this.attRoll, phi, 0.15, dt);
    } else {
      this.attPitch = approach(this.attPitch, 12 * DEG, 40, dt);
      this.attRoll = approach(this.attRoll, 35 * DEG, 40, dt);
    }
    ind.pitchDeg = this.attPitch * RAD;
    ind.rollDeg = this.attRoll * RAD;

    // Heading indicator: integrates the yaw rate it senses; drifts ~3 deg/15 min when spun up
    const magHeading = (psi * RAD - EGPH_MAG_VAR + 360) % 360;
    if (this.dgSpin > 0.6) {
      const r = ac.q.rotate(ac.omega).z; // earth-frame yaw rate (NED z)
      this.dgHeading += r * RAD * dt + 0.0033 * dt;
    }
    ind.headingDeg = ((this.dgHeading % 360) + 360) % 360;
    ind.compassDeg = magHeading;

    // Turn coordinator (electric rate gyro, canted to sense roll rate too) and inclinometer ball
    const earthRates = ac.q.rotate(ac.omega);
    const tcRate = (earthRates.z + 0.25 * ac.omega.x) * RAD * this.tcSpin;
    ind.turnRateDegS = approach(ind.turnRateDegS, tcRate, 0.3, dt);
    ind.turnFlag = this.tcSpin < 0.6;
    const sf = ac.specificForce;
    const ballTarget = clamp(Math.atan2(sf.y, -sf.z === 0 ? 1e-6 : -sf.z) / (8 * DEG), -1, 1);
    ind.slipBall = approach(ind.slipBall, ac.onGround && ac.tas < 1 ? 0 : -ballTarget, 0.25, dt);

    // Engine
    ind.rpm = eng.rpm;
    ind.manifoldInHg = eng.manifoldPressure / 3386.39;
    ind.oilTempF = (eng.oilTemp - 273.15) * 1.8 + 32;
    ind.oilPressPsi = eng.oilPressure / 6894.76;
    ind.egtF = (eng.egt - 273.15) * 1.8 + 32;
    ind.chtF = (eng.cht - 273.15) * 1.8 + 32;
    ind.fuelFlowGph = (eng.fuelFlow / AVGAS) * 3600 / GAL;
    const pow = this.busVolts > 18;
    ind.fuelLeftGal = pow ? ac.fuel[0] / AVGAS / GAL : 0;
    ind.fuelRightGal = pow ? ac.fuel[1] / AVGAS / GAL : 0;
    ind.vacuumInHg = this.vacuum;
    ind.busVolts = this.busVolts;
    ind.ammeterA = this.batteryAmps;
    ind.oatC = ac.air.temperature - 273.15;
    ind.stallHorn = ac.stallWarning && c.masterBattery;
    ind.lowVacuum = this.vacuum < 3.5 && pow;
    ind.lowVolts = this.busVolts < 24.5 && pow;
    ind.lowFuelL = pow && ind.fuelLeftGal < 5;
    ind.lowFuelR = pow && ind.fuelRightGal < 5;
    ind.lowOilPress = pow && ind.oilPressPsi < 20;
    ind.gyrosValid = this.attGyroSpin > 0.6;
    ind.avionicsPowered = pow && c.avionics;
  }
}
