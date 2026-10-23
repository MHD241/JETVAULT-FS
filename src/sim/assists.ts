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
  private holdCas: number | null = null;
  private thetaRef = 0;
  private vsInt = 0;
  private servo = 0;

  update(dt: number, ac: Aircraft, c: FlightControls, stickPitch: number): number {
    const ctl = ac.def.controls;
    if (ac.onGround || Math.abs(stickPitch) > 0.05 || ac.cable) {
      this.holdVs = null;
      this.holdCas = null;
      this.servo = moveToward(this.servo, 0, 2 * dt);
      return this.servo;
    }
    const vs = -ac.vel.z;
    const theta = ac.euler[1];
    if (ac.def.glider) {
      // glider: hold the airspeed at stick release (the stick sets speed, as with a trimmed glider);
      // below 10 m the descent is eased (flare) so the landing is gentle.
      if (this.holdCas === null) { this.holdCas = Math.max(ac.cas, 20); this.thetaRef = theta; this.vsInt = 0; this.holdVs = 0; }
      const err = ac.cas - this.holdCas; // m/s, + = too fast -> raise the nose
      let thetaCmd: number;
      if (ac.agl < 10 && vs < -0.6) {
        const tgt = -(0.3 + 0.1 * Math.max(ac.agl, 0));
        thetaCmd = clamp(theta + (tgt - vs) * 3 * DEG, -8 * DEG, 10 * DEG);
      } else {
        this.vsInt = clamp(this.vsInt + err * 0.4 * DEG * dt, -15 * DEG, 15 * DEG);
        thetaCmd = clamp(this.thetaRef + this.vsInt + err * 1.0 * DEG, -25 * DEG, 20 * DEG);
      }
      const cmdG = clamp(3.0 * (thetaCmd - theta) - 1.0 * ac.omega.y, -0.5, 0.5);
      this.servo = moveToward(this.servo, cmdG, 0.6 * dt);
      const epsG = this.servo >= 0 ? ctl.elevatorUp : ctl.elevatorDown;
      const ntG = clamp(c.trim + clamp(this.servo * 0.15, -0.04, 0.04) * dt, -1, 1);
      this.servo -= ((ntG - c.trim) * ctl.trimRange) / epsG;
      c.trim = ntG;
      return this.servo;
    }
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
    // jets: do not hold a climb rate that bleeds the speed below a safe climb speed (reduces the held VS)
    if (ac.def.turbofans && target > 0) {
      const vMin = ac.def.profile.approachKias * (ac.flap > 1 * DEG ? 1.15 : 1.3);
      const deficit = vMin - ac.cas / 0.514444;
      if (deficit > 0) target = Math.max(0, target - deficit * 0.25);
    }
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
