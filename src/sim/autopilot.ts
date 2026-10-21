// Two-axis autopilot modelled on the Bendix/King KAP 140 fitted to the C172S.
// It does not move the aircraft: it moves the aileron and elevator through rate- and
// authority-limited servos (plus automatic pitch trim), exactly like the pilot's own
// inputs, so the airplane still flies through the flight model.
//
// Lateral modes:  ROL (wings level), HDG (heading bug)
// Vertical modes: VS (vertical speed hold), ALT (altitude hold)

import { clamp, DEG, FT, moveToward } from '../core/math';
import { Aircraft } from './fdm/aircraft';
import { C172Systems } from './systems/c172Systems';
import { FlightControls } from './controls';

export type LateralMode = 'ROL' | 'HDG';
export type VerticalMode = 'VS' | 'ALT';

export class Autopilot {
  engaged = false;
  lateral: LateralMode = 'ROL';
  vertical: VerticalMode = 'VS';
  targetAltFt = 3000;
  targetVsFpm = 0;
  servoRoll = 0;
  servoPitch = 0;
  trimRate = 0;
  disconnectReason = '';
  private vsInt = 0;
  private hdgInt = 0;
  private thetaRef: number | null = null;
  private out: FlightControls | null = null;

  engage(sys: C172Systems) {
    if (!sys.busPowered()) { this.disconnectReason = 'No power'; return; }
    this.engaged = true;
    this.disconnectReason = '';
    this.lateral = 'ROL';
    this.vertical = 'VS';
    this.targetVsFpm = Math.round(sys.ind.vsiFpm / 100) * 100;
    this.servoPitch = 0;
    this.servoRoll = 0;
    this.vsInt = 0;
    this.hdgInt = 0;
    this.thetaRef = null;
  }

  disengage(reason = '') {
    this.engaged = false;
    this.disconnectReason = reason;
  }

  /** Captures the current altitude for ALT hold. */
  holdAltitude(sys: C172Systems) {
    this.vertical = 'ALT';
    this.targetAltFt = Math.round(sys.ind.altitudeFt / 20) * 20;
  }

  apply(dt: number, ac: Aircraft, sys: C172Systems, c: FlightControls) {
    if (!this.engaged) { this.out = null; return; }
    if (!sys.busPowered() || !c.avionics) { this.disengage('Autopilot power lost'); this.out = null; return; }
    if (Math.abs(c.pitch) > 0.6 || Math.abs(c.roll) > 0.6) { this.disengage('Pilot override'); this.out = null; return; }
    if (ac.onGround) { this.disengage('On ground'); this.out = null; return; }
    const [phi, theta] = ac.euler;
    const ctl = ac.def.controls;

    // --- lateral: heading -> bank -> aileron servo
    let bankCmd = 0;
    if (this.lateral === 'HDG') {
      let err = c.headingBug - sys.ind.headingDeg;
      err = ((err + 540) % 360) - 180;
      this.hdgInt = Math.abs(err) < 10 ? clamp(this.hdgInt + err * dt * 0.02, -3, 3) : this.hdgInt * 0.99;
      bankCmd = clamp(err * 0.8 + this.hdgInt, -20, 20) * DEG;
    } else {
      this.hdgInt = 0;
    }
    const rollCmd = clamp(1.4 * (bankCmd - phi) - 0.45 * ac.omega.x, -0.3, 0.3);
    this.servoRoll = moveToward(this.servoRoll, rollCmd, 0.5 * dt);

    // --- vertical: altitude -> vertical speed -> pitch attitude -> elevator servo
    const vs = -ac.vel.z; // static-port rate (m/s), unlagged for the computer
    let vsCmd = (this.targetVsFpm * FT) / 60;
    if (this.vertical === 'ALT') {
      vsCmd = clamp(((this.targetAltFt - sys.ind.altitudeFt) * FT) * 0.08, -3.5, 3.5);
    }
    const errVs = vsCmd - vs;
    this.vsInt = clamp(this.vsInt + errVs * 0.25 * DEG * dt, -12 * DEG, 15 * DEG);
    if (this.thetaRef === null) this.thetaRef = theta;
    const thetaCmd = clamp(this.thetaRef + this.vsInt + errVs * 1.2 * DEG, -10 * DEG, 15 * DEG);
    const pitchCmd = clamp(3.0 * (thetaCmd - theta) - 0.9 * ac.omega.y, -0.45, 0.45);
    this.servoPitch = moveToward(this.servoPitch, pitchCmd, 0.6 * dt);

    // --- automatic electric trim: move the trim, and unload the servo by the same
    // elevator angle, so the hand-off is seamless
    const elevPerStick = this.servoPitch >= 0 ? ctl.elevatorUp : ctl.elevatorDown;
    const trimStep = clamp(this.servoPitch * 0.15, -0.04, 0.04) * dt;
    const newTrim = clamp(c.trim + trimStep, -1, 1);
    const dTrim = newTrim - c.trim;
    c.trim = newTrim;
    this.servoPitch -= (dTrim * ctl.trimRange) / elevPerStick;
    this.trimRate = trimStep / dt;

    this.out = { ...c, pitch: clamp(c.pitch + this.servoPitch, -1, 1), roll: clamp(c.roll + this.servoRoll, -1, 1) };
  }

  effectiveControls(c: FlightControls): FlightControls {
    return this.engaged && this.out ? this.out : c;
  }
}
