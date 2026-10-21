// High-bypass turbofan (CFM56-7B class) for the 737-800.
//
// N1 (fan speed, %) follows the thrust lever through first-order spool dynamics whose
// time constant is long near idle and short at high power (a jet takes ~6-8 s to spool
// from idle to take-off thrust). Thrust = rated static thrust x f(N1) x density lapse x
// Mach (ram drag) lapse. Reverse thrust is available only on the ground at idle.
// Values marked ESTIMATE are engineering estimates, not manufacturer data.

import { clamp, approach } from '../../core/math';
import { AirState } from '../atmosphere';
import { EngineInputs } from './piston';

export interface TurbofanDef {
  /** Rated static sea-level thrust, N (CFM56-7B26: 26,300 lbf = 117 kN, public type data). */
  ratedThrust: number;
  /** Ground idle N1, % (ESTIMATE ~21 %). */
  idleN1: number;
  /** Maximum N1, % . */
  maxN1: number;
  /** Fraction of forward thrust available in reverse (ESTIMATE). */
  reverseFraction: number;
  /** Thrust-specific fuel consumption at take-off, kg/(N s) (ESTIMATE ~0.36 lb/lbf/h). */
  tsfc: number;
  /** Idle fuel flow, kg/s (ESTIMATE ~550 lb/h). */
  idleFuelFlow: number;
}

export class TurbofanEngine {
  n1 = 0; // %
  n2 = 0; // %
  running = false;
  thrust = 0;
  fuelFlow = 0; // kg/s
  power = 0;
  propTorque = 0;
  engineTorque = 0;
  slipstreamDeltaV = 0;
  egt = 288; // K
  cht = 288;
  oilTemp = 288;
  oilPressure = 0;
  manifoldPressure = 0;
  starterEngaged = false;
  crankTime = 0;
  reverserDeployed = 0; // 0..1 sleeve position
  readonly kind = 'turbofan' as const;

  constructor(public def: TurbofanDef) {}

  /** Internal convention shared with the piston engine: "rpm" = N1 % x 100. */
  get rpm() { return this.n1 * 100; }
  set rpm(v: number) { this.n1 = v / 100; this.n2 = Math.min(100, 40 + this.n1 * 0.6); }

  warmUp(rpm: number, _air: AirState) {
    this.rpm = Math.max(rpm, this.def.idleN1 * 100);
    this.running = true;
    this.egt = 700; this.oilTemp = 350; this.oilPressure = 300000;
  }

  /** Thrust fraction of rated static thrust as a function of N1 (ESTIMATE, smooth fit). */
  thrustFraction(n1: number) {
    const x = clamp((n1 - this.def.idleN1) / (100 - this.def.idleN1), 0, 1.05);
    return 0.035 + 0.965 * Math.pow(x, 1.9);
  }

  step(dt: number, inp: EngineInputs & { reverse?: boolean; onGround?: boolean }, air: AirState, vAxial: number) {
    const d = this.def;
    const fuelOn = inp.mixture > 0.5 && inp.fuelAvailable;
    // start: starter (START) with power spins N2; light-off at ~25 % N2 with fuel
    this.starterEngaged = inp.mags === 'START' && inp.starterPower;
    if (!this.running) {
      const target = this.starterEngaged ? 30 : 0;
      this.n2 = approach(this.n2, target, 8, dt);
      this.n1 = this.n2 * 0.3;
      if (fuelOn && this.n2 > 24) { this.crankTime += dt; if (this.crankTime > 2) this.running = true; }
    }
    if (!fuelOn) { this.running = false; this.crankTime = 0; }

    // reversers: sleeves translate in ~2 s, only on the ground with the lever at idle
    const revCmd = Boolean(inp.reverse && inp.onGround && this.running);
    this.reverserDeployed = approach(this.reverserDeployed, revCmd ? 1 : 0, 0.7, dt);

    if (this.running) {
      const lever = revCmd && this.reverserDeployed > 0.9 ? clamp(inp.throttle, 0, 1) : this.reverserDeployed > 0.1 ? 0 : clamp(inp.throttle, 0, 1);
      // flight idle is higher than ground idle (approach idle) - ESTIMATE
      const idle = inp.onGround ? d.idleN1 : d.idleN1 + 9;
      const target = idle + (d.maxN1 - idle) * lever;
      // spool time constant: slow near idle, fast at high N1 (ESTIMATE ~7 s idle -> TO)
      const tau = 0.9 + 3.2 * (1 - clamp((this.n1 - d.idleN1) / (100 - d.idleN1), 0, 1));
      this.n1 = approach(this.n1, target, tau, dt);
      this.n2 = 58 + 0.42 * this.n1;
    }
    const sigma = air.density / 1.225;
    const mach = clamp(vAxial / air.speedOfSound, 0, 0.9);
    // net thrust lapse with ram drag (ESTIMATE typical high-bypass behaviour)
    const machLapse = 1 - 0.95 * mach + 0.55 * mach * mach;
    const gross = this.running || this.n1 > 1 ? d.ratedThrust * this.thrustFraction(this.n1) * Math.pow(sigma, 0.75) * machLapse : 0;
    const rev = this.reverserDeployed;
    this.thrust = gross * (1 - rev) - gross * d.reverseFraction * rev * (this.running ? 1 : 0);
    this.fuelFlow = this.running ? d.idleFuelFlow + d.tsfc * Math.max(0, gross - d.ratedThrust * 0.035) : 0;
    this.power = Math.abs(this.thrust * Math.max(vAxial, 0));
    const egtTarget = this.running ? 273 + 400 + 5.2 * this.n1 + 120 * Math.max(0, (this.n1 - 85) / 15) : air.temperature;
    this.egt = approach(this.egt, egtTarget, 2.5, dt);
    this.oilTemp = approach(this.oilTemp, this.running ? 360 : air.temperature, 200, dt);
    this.oilPressure = approach(this.oilPressure, this.running ? (180 + 3 * this.n2) * 1000 : 0, 1.5, dt);
  }
}
