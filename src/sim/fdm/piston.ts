// Normally aspirated piston engine driving a fixed-pitch propeller.
//
// Engine: power is derived from the mass flow of air through the cylinders
// (displacement x RPM x manifold density x volumetric efficiency), the fuel/air ratio
// set by the mixture, and ignition (magnetos). Friction and pumping losses grow with
// RPM. Altitude power lapse, rich/lean behaviour, mag-drop and idle-cutoff shutdown
// all follow from this rather than from scripted values.
//
// Propeller: thrust and power coefficients as functions of advance ratio J = V/(nD).
// The shaft speed is integrated from engine torque minus propeller torque, so RPM
// rises with airspeed (windmilling) and falls in a climb as on the real aircraft.

import { interp, clamp, approach } from '../../core/math';
import { AirState, R_AIR } from '../atmosphere';

export interface PistonEngineDef {
  /** Displacement, m^3. */
  displacement: number;
  /** Rated power, W, at ratedRpm (sea level standard, full throttle, best power mixture). */
  ratedPower: number;
  ratedRpm: number;
  maxRpm: number;
  idleRpm: number;
  /** Rotational inertia of engine + propeller, kg m^2. */
  inertia: number;
  /** Starter motor torque at zero speed, N m (falls linearly to zero at starterMaxRpm). */
  starterTorque: number;
  starterMaxRpm: number;
  /** Mixture lever = 1 gives this fuel/air ratio at sea level. */
  fullRichFAR: number;
}

export interface PropellerDef {
  diameter: number;
  /** Advance ratio table. */
  J: number[];
  CT: number[];
  CP: number[];
}

export type MagSwitch = 'OFF' | 'R' | 'L' | 'BOTH' | 'START';

export interface EngineInputs {
  throttle: number; // 0..1
  mixture: number; // 0..1 (0 = idle cut-off)
  mags: MagSwitch;
  starterPower: boolean; // electrical power available to the starter
  fuelAvailable: boolean;
}

export class PistonEngine {
  rpm = 0;
  running = false;
  manifoldPressure = 0; // Pa
  fuelFlow = 0; // kg/s
  power = 0; // brake power, W
  thrust = 0; // N
  propTorque = 0; // N m (aerodynamic, positive absorbs power)
  engineTorque = 0;
  egt = 288; // K
  cht = 288; // K
  oilTemp = 288; // K
  oilPressure = 0; // Pa
  far = 0;
  starterEngaged = false;
  /** Accumulated cranking time with ignition and fuel, s. */
  crankTime = 0;
  /** Induced velocity increment far downstream of the disc (for slipstream), m/s. */
  slipstreamDeltaV = 0;
  private kPower: number;
  private frictionA: number;
  private frictionB: number;

  constructor(public def: PistonEngineDef, public prop: PropellerDef) {
    // Calibrate the air-mass-flow -> indicated power constant so that rated power is
    // produced at sea level, rated RPM, full throttle and best-power mixture.
    const sl: AirState = { pressure: 101325, temperature: 288.15, density: 1.225, speedOfSound: 340.3 };
    const mdot = this.usefulAirFlow(def.ratedRpm, this.mapFor(1, def.ratedRpm, sl), sl);
    // friction power = A*omega + B*omega^2 (FMEP-like); ~14 % of rated power at rated rpm
    const omegaR = (def.ratedRpm * 2 * Math.PI) / 60;
    const pf = def.ratedPower * 0.14;
    this.frictionB = (0.7 * pf) / (omegaR * omegaR);
    this.frictionA = (0.3 * pf) / omegaR;
    this.kPower = (def.ratedPower + pf) / mdot;
  }

  /** Manifold absolute pressure for throttle position and rpm. */
  private mapFor(throttle: number, rpm: number, air: AirState) {
    // Throttle plate: effective open area fraction (nonlinear butterfly); at closed throttle
    // the manifold is pumped down further as rpm increases.
    const area = 0.015 + 0.985 * Math.pow(clamp(throttle, 0, 1), 1.6);
    const demand = (rpm / this.def.ratedRpm) * 0.12; // pumping demand relative to choke
    const ratio = area / (area + demand);
    return air.pressure * clamp(0.97 * ratio, 0.18, 0.97);
  }

  private airMassFlow(rpm: number, map: number, temp: number) {
    const ve = 0.85;
    const rhoManifold = map / (R_AIR * temp);
    return ve * this.def.displacement * (rpm / 60 / 2) * rhoManifold;
  }

  /**
   * Air flow that produces useful work. Part of every intake charge only overcomes heat
   * and pumping losses, which is why a throttled engine needs ~10 inHg to idle; modelled
   * as the flow at 20 % of sea-level pressure being "lost". This also yields the
   * Gagg-Ferrar style altitude power lapse.
   */
  private usefulAirFlow(rpm: number, map: number, air: AirState) {
    const lost = this.airMassFlow(rpm, 0.2 * 101325, air.temperature);
    return Math.max(0, this.airMassFlow(rpm, map, air.temperature) - lost);
  }

  /** Power multiplier from fuel/air ratio (best power ~0.077, lean/rich limits). */
  static mixtureFactor(far: number) {
    if (far < 0.045 || far > 0.14) return 0;
    if (far < 0.077) return clamp(0.15 + 0.85 * ((far - 0.045) / 0.032) ** 0.8, 0, 1);
    return clamp(1 - 0.35 * ((far - 0.077) / 0.063) ** 1.3, 0, 1);
  }

  step(dt: number, inp: EngineInputs, air: AirState, trueAirspeedAxial: number) {
    const d = this.def;
    const omega = (this.rpm * 2 * Math.PI) / 60;
    const mapP = this.mapFor(inp.throttle, this.rpm, air);
    this.manifoldPressure = approach(this.manifoldPressure || air.pressure, mapP, 0.08, dt);
    const mdotAir = this.airMassFlow(this.rpm, this.manifoldPressure, air.temperature);

    // Fuel metering: fuel injection meters fuel against air flow at sea level density,
    // so the mixture becomes richer with altitude unless leaned.
    this.far = inp.mixture * d.fullRichFAR * Math.sqrt(1.225 / air.density);
    const ignition = inp.mags === 'BOTH' || inp.mags === 'START' ? 1 : inp.mags === 'L' || inp.mags === 'R' ? 0.965 : 0;
    const mix = PistonEngine.mixtureFactor(this.far);
    const canFire = ignition > 0 && inp.fuelAvailable && mix > 0 && this.rpm > 60;
    // A cold engine needs a couple of seconds of cranking to fill the induction with a
    // combustible charge before it catches; it stops when it can no longer fire.
    if (canFire && this.rpm > 100 && !this.running) {
      this.crankTime += dt;
      if (this.crankTime > 1.8) this.running = true;
    }
    if (!canFire || this.rpm < 40) { this.running = false; }
    if (!canFire || this.rpm < 60) this.crankTime = Math.max(0, this.crankTime - dt);

    const useful = this.usefulAirFlow(this.rpm, this.manifoldPressure, air);
    const indicated = this.running ? this.kPower * useful * mix * ignition : 0;
    this.fuelFlow = this.running ? mdotAir * this.far : 0;
    const friction = this.rpm > 1 ? this.frictionA * omega + this.frictionB * omega * omega : 0; // W
    // Compression / friction resists rotation even when not running
    const fricTorque = this.rpm > 1 ? friction / Math.max(omega, 1) + (this.running ? 0 : 6) : 0;

    // Starter
    this.starterEngaged = inp.mags === 'START' && inp.starterPower;
    const starter = this.starterEngaged ? d.starterTorque * clamp(1 - this.rpm / d.starterMaxRpm, 0, 1) : 0;

    // Propeller
    const n = this.rpm / 60;
    const D = this.prop.diameter;
    const V = Math.max(0, trueAirspeedAxial);
    let thrust = 0, qProp = 0;
    if (n > 0.5) {
      const J = V / (n * D);
      const ct = interp(this.prop.J, this.prop.CT, J);
      const cp = interp(this.prop.J, this.prop.CP, J);
      thrust = ct * air.density * n * n * D ** 4;
      const pAbs = cp * air.density * n ** 3 * D ** 5;
      qProp = pAbs / (2 * Math.PI * n);
    } else if (V > 1) {
      // Stopped prop: blade drag tends to start windmilling; approximate torque from airflow
      qProp = -0.002 * air.density * V * V * D ** 3;
      thrust = -0.015 * air.density * V * V * D * D;
    }
    this.engineTorque = omega > 0.5 ? indicated / omega : 0;
    const net = this.engineTorque + starter - fricTorque - qProp;
    let newOmega = omega + (net / d.inertia) * dt;
    if (newOmega < 0) newOmega = 0;
    this.rpm = (newOmega * 60) / (2 * Math.PI);
    this.thrust = thrust;
    this.propTorque = qProp;
    this.power = Math.max(0, indicated - friction);

    // Slipstream (actuator disc): far-wake velocity increment
    const A = Math.PI * D * D * 0.25;
    const disc = V * V + (2 * Math.max(0, thrust)) / (air.density * A);
    this.slipstreamDeltaV = Math.sqrt(disc) - V;

    // Temperatures and oil pressure (first-order thermal model, indications only)
    const load = indicated / d.ratedPower;
    const egtTarget = this.running ? 500 + 450 * clamp(load, 0, 1.2) * (1 - 0.6 * Math.abs(this.far - 0.065) / 0.05) : air.temperature;
    this.egt = approach(this.egt, egtTarget, 4, dt);
    const coolV = Math.max(V, 0) + this.slipstreamDeltaV * 0.5;
    const chtTarget = this.running ? air.temperature + 140 + 160 * load - 0.6 * coolV : air.temperature;
    this.cht = approach(this.cht, chtTarget, 90, dt);
    const oilTarget = this.running ? air.temperature + 60 + 40 * load : air.temperature;
    this.oilTemp = approach(this.oilTemp, oilTarget, 240, dt);
    const oilP = this.rpm > 100 ? clamp(this.rpm / 2400, 0, 1) * 420000 * (1 - 0.25 * clamp((this.oilTemp - 330) / 60, 0, 1)) : 0;
    this.oilPressure = approach(this.oilPressure, oilP, 0.5, dt);
  }
}
