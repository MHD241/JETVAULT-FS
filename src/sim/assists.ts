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
 * (Now trim-only: nothing is added to the pilot's stick.)
 */
export class AutoTrim {
  private holdVs: number | null = null;
  private holdCas: number | null = null;
  private thetaRef = 0;
  private vsInt = 0;
  private servo = 0;
  private applied = 0;

  /**
   * Holds the flight path hands-off by moving the pitch TRIM only. It never adds anything to the stick channel,
   * so the control (and the yoke) always equals what the pilot does and nothing steps when the stick passes the centre.
   * The correction fades out smoothly as the stick leaves the centre. Returns 0 (signature kept for the caller).
   */
  update(dt: number, ac: Aircraft, c: FlightControls, stickPitch: number): number {
    const ctl = ac.def.controls;
    const w = clamp(1 - (Math.abs(stickPitch) - 0.02) / 0.1, 0, 1); // 1 at the centre, 0 beyond 12 % stick
    if (ac.onGround || w <= 0 || ac.cable) { this.holdVs = null; this.holdCas = null; this.servo = 0; this.applied = 0; return 0; } // what was applied stays in the trim
    const vs = -ac.vel.z, theta = ac.euler[1];
    let cmd: number;
    if (ac.def.glider) {
      // glider: hold the airspeed at release (the stick sets speed, as with a trimmed glider)
      if (this.holdCas === null) { this.holdCas = Math.max(ac.cas, 20); this.thetaRef = theta; this.vsInt = 0; }
      const err = ac.cas - this.holdCas;
      this.vsInt = clamp(this.vsInt + err * 0.4 * DEG * dt, -15 * DEG, 15 * DEG);
      const thetaCmd = clamp(this.thetaRef + this.vsInt + err * 1.0 * DEG, -25 * DEG, 20 * DEG);
      cmd = clamp(3.0 * (thetaCmd - theta) - 1.0 * ac.omega.y, -0.5, 0.5);
    } else {
      if (this.holdVs === null) { this.holdVs = Math.abs(vs) < 1.5 ? 0 : vs; this.thetaRef = theta; this.vsInt = 0; }
      const errVs = this.holdVs - vs;
      this.vsInt = clamp(this.vsInt + errVs * 0.25 * DEG * dt, -12 * DEG, 15 * DEG);
      const thetaCmd = clamp(this.thetaRef + this.vsInt + errVs * 1.2 * DEG, -10 * DEG, 15 * DEG);
      cmd = clamp(3.0 * (thetaCmd - theta) - 0.9 * ac.omega.y, -0.45, 0.45);
    }
    // The hold works like a servo that drives the elevator through the TRIM channel only: part of it is the transient servo
    // (reached at a limited rate, weighted by w so it fades out continuously as the stick leaves the centre), and the trim
    // slowly takes over its load for good (same structure as before, nothing is added to the pilot's stick).
    this.servo = moveToward(this.servo, cmd, 0.6 * dt);
    const perStick = this.servo >= 0 ? ctl.elevatorUp : ctl.elevatorDown;
    const absorb = clamp(this.servo * 0.15, -0.04, 0.04) * dt; // trim travel taken over from the servo this step
    this.servo -= (absorb * ctl.trimRange) / perStick;
    const applied = (this.servo * w * perStick) / ctl.trimRange;
    const base = c.trim - this.applied + absorb;
    c.trim = clamp(base + applied, -1, 1);
    this.applied = c.trim - base;
    return 0;
  }
}

/** Neutral-stick trim for an aircraft with a trim model (the 737): depends on the flap lever, the speed (kt) and the throttle. */
export function trimFor(profile: { trimModel?: { t0: number[]; kr: number[]; s: number[]; b: number } }, lever: number, kt: number, thr: number): number | null {
  const m = profile.trimModel; if (!m) return null;
  const i = Math.max(0, Math.min(m.t0.length - 1, Math.round(lever))), v = Math.max(kt, 90), inv = 1 / (v * v);
  return clamp(m.t0[i] + m.s[i] * (inv - 1 / (m.kr[i] * m.kr[i])) - (m.b * (thr - 0.5)) * inv, -1, 1);
}
