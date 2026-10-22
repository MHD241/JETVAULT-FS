// Optional pilot assists. They only move cockpit controls (stick/trim), never the
// aircraft state, so the flight model is unchanged.

import { clamp, DEG, moveToward } from '../core/math';
import { Aircraft } from './fdm/aircraft';
import { FlightControls } from './controls';

/**
 * Auto-trim / flight-path hold (beginner assist, similar to MSFS auto-trim or Boeing
 * control-wheel steering): when the pitch input is released in flight, a small
 * rate-limited elevator servo holds the vertical speed the aircraft had at release
 * (level flight if it was within +/-300 fpm), and the trim wheel continuously takes
 * over the servo's load. Same control structure as the autopilot pitch channel.
 * Returns the stick offset to add to the pilot's pitch input.
 */
export class AutoTrim {
  private holdVs: number | null = null;
  private thetaRef = 0;
  private vsInt = 0;
  private servo = 0;

  update(dt: number, ac: Aircraft, c: FlightControls, stickPitch: number): number {
    const ctl = ac.def.controls;
    if (ac.onGround || Math.abs(stickPitch) > 0.05) {
      this.holdVs = null;
      this.servo = moveToward(this.servo, 0, 2 * dt);
      return this.servo;
    }
    const vs = -ac.vel.z;
    const theta = ac.euler[1];
    if (this.holdVs === null) {
      this.holdVs = Math.abs(vs) < 1.5 ? 0 : vs;
      this.thetaRef = theta;
      this.vsInt = 0;
    }
    // landing assist: with the stick released near the ground a descent is eased to a gentle
    // sink rate (flare), ~0.45 m/s at touchdown. It only moves the elevator servo.
    let target = this.holdVs;
    let maxTheta = 15 * DEG;
    if (target < -0.3 && ac.agl < 18) { target = Math.max(target, -(0.45 + 0.1 * Math.max(ac.agl, 0))); maxTheta = 7 * DEG; } // never over-rotate into a tail strike
    const errVs = target - vs;
    this.vsInt = clamp(this.vsInt + errVs * 0.25 * DEG * dt, -12 * DEG, 15 * DEG);
    const thetaCmd = clamp(this.thetaRef + this.vsInt + errVs * 1.2 * DEG, -10 * DEG, maxTheta);
    const cmd = clamp(3.0 * (thetaCmd - theta) - 0.9 * ac.omega.y, -0.45, 0.45);
    this.servo = moveToward(this.servo, cmd, 0.6 * dt);
    // trim takes over the servo load (same elevator angle, seamless)
    const elevPerStick = this.servo >= 0 ? ctl.elevatorUp : ctl.elevatorDown;
    const step = clamp(this.servo * 0.15, -0.04, 0.04) * dt;
    const nt = clamp(c.trim + step, -1, 1);
    this.servo -= ((nt - c.trim) * ctl.trimRange) / elevPerStick;
    c.trim = nt;
    return this.servo;
  }
}
