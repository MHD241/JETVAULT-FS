// Fly-by-wire style flight assist for the jets (737, A320, A340, A350, C-17) plus a simple autopilot / autothrottle.
// Like the other assists it only moves cockpit controls (elevator, aileron, throttle), never the aircraft state, so the flight model is unchanged.
//
//  Pitch: the stick commands a PITCH RATE; released, the aircraft holds its FLIGHT PATH angle (so it stays in a climb, descent or level flight by itself,
//         also in a turn). An integrator in the elevator channel takes the place of trim.
//  Roll:  the stick commands a BANK ANGLE (up to 35 deg); released, the wings level themselves.
//  Autopilot: altitude (with capture), heading and speed (autothrottle) targets drive the same two laws.
//  Below about 50 ft the pitch law fades back to the direct stick (plus the trim the integrator had found), so the flare and landing are manual.

import { clamp, DEG } from '../core/math';
import { Aircraft } from './fdm/aircraft';
import { FlightControls } from './controls';

const G = 9.80665, FT = 0.3048, KT = 0.514444;

export interface ApState { on: boolean; alt: number; hdg: number; spd: number; autothrottle: boolean }

export class FlyByWire {
  private gammaCmd = 0;
  private pitchI = 0;
  private holding = false;
  private thrI = 0;
  private vsI = 0;
  /** Autopilot state; alt in metres, hdg in radians (true), spd in m/s (CAS). */
  ap: ApState = { on: false, alt: 0, hdg: 0, spd: 0, autothrottle: true };
  /** Last throttle the autothrottle wants (0..1); the caller copies it to the throttle lever while ap.on && ap.autothrottle. */
  throttleCmd = 0;
  /** Set when the pilot pulled the stick hard enough to cancel the autopilot. */
  apCancelled = false;

  /** The assist works only in the air and above about 15 m; below that the stick is direct. */
  static active(ac: Aircraft): boolean { return !ac.onGround && ac.agl > 8 && !ac.crashed && !ac.def.drone && !ac.def.glider && !!ac.def.turbofans; }

  engageAp(ac: Aircraft) {
    this.ap.on = true; this.apCancelled = false;
    this.ap.alt = Math.round(ac.altitude / (100 * FT)) * 100 * FT;
    this.ap.hdg = ac.euler[2]; this.ap.spd = Math.max(Math.round(ac.cas / (5 * KT)) * 5 * KT, 60);
    this.vsI = 0; this.thrI = 0; this.throttleCmd = 0.6;
  }
  disengageAp() { this.ap.on = false; }

  /** A heading bug / altitude / speed nudge from the keyboard. */
  adjust(what: 'alt' | 'hdg' | 'spd', dir: 1 | -1) {
    if (what === 'alt') this.ap.alt = Math.max(0, this.ap.alt + dir * 500 * FT);
    else if (what === 'hdg') { this.ap.hdg += dir * 5 * DEG; this.ap.hdg = Math.atan2(Math.sin(this.ap.hdg), Math.cos(this.ap.hdg)); }
    else this.ap.spd = Math.max(60 * KT, this.ap.spd + dir * 5 * KT);
  }

  /**
   * stickPitch / stickRoll: -1..1 (+ = nose up / roll right). Writes c.pitch and c.roll. Returns true if the assist took the controls.
   * directPitch: what the direct law would give (used below 50 ft so the stick takes over smoothly).
   */
  update(dt: number, ac: Aircraft, stickPitch: number, stickRoll: number, c: FlightControls, directPitch: number): boolean {
    if (!FlyByWire.active(ac)) { this.holding = false; this.pitchI *= Math.max(0, 1 - dt); return false; }
    const k = Math.max(0.6, Math.sqrt(ac.def.wingSpan / 35.8));          // size relative to the 737: slower, heavier airframes get proportionally gentler gains
    const [phi, , psi] = ac.euler;
    const V = Math.max(ac.tas, 40);
    const vel = ac.vel, gamma = Math.atan2(-vel.z, Math.hypot(vel.x, vel.y));
    const q = ac.omega.y, p = ac.omega.x;

    let sp = stickPitch, sr = stickRoll;
    if (this.ap.on && (Math.abs(sp) > 0.75 || Math.abs(sr) > 0.75)) { this.ap.on = false; this.apCancelled = true; }   // a firm stick input cancels the autopilot
    let bankCmd = sr * 35 * DEG;
    let qCmd: number;

    if (this.ap.on) {
      // altitude: a vertical speed command proportional to the error (capture), limited to +/-2000 fpm and the climb the aircraft has thrust for
      const altErr = this.ap.alt - ac.altitude;
      this.vsI = clamp(this.vsI + altErr * 0.0006 * dt, -2.5, 2.5);   // takes out the small steady offset left by the capture
      const vsCmd = clamp(altErr * 0.08 + (Math.abs(altErr) < 60 ? this.vsI : 0), -9, 9);
      this.gammaCmd = clamp(Math.asin(clamp(vsCmd / V, -0.2, 0.2)), -6 * DEG, 8 * DEG);
      // heading: bank up to 25 degrees towards the target heading
      let he = this.ap.hdg - psi; he = Math.atan2(Math.sin(he), Math.cos(he));
      bankCmd = clamp(he * 1.6, -25 * DEG, 25 * DEG);
      this.holding = true;
      // autothrottle: hold the speed target with a PI on the speed error (feed-forward from the throttle position when the AP was engaged)
      if (this.ap.autothrottle) {
        const e = this.ap.spd - ac.cas;
        this.thrI = clamp(this.thrI + e * 0.0012 * dt * 60, -0.5, 0.5);
        this.throttleCmd = clamp(0.55 + e * 0.05 + this.thrI + clamp(this.gammaCmd, -0.1, 0.1) * 2.5, 0.05, 1);
      }
    } else {
      // stick: pitch rate command (max 6 deg/s); released: hold the flight path angle the aircraft had when the stick came back to the centre
      if (Math.abs(sp) > 0.04) { this.holding = false; this.gammaCmd = gamma; }
      else if (!this.holding) { this.holding = true; this.gammaCmd = gamma; }
      if (this.holding) this.gammaCmd = clamp(this.gammaCmd, -15 * DEG, 20 * DEG);
    }

    // pitch rate wanted: from the stick, or from the flight-path error; plus the rate a bank needs to hold the path (turn feed-forward)
    const turnQ = (G / V) * Math.tan(phi) * Math.sin(phi);
    const holdErr = this.gammaCmd - gamma;
    const ko = 1 / (k * k);          // the outer flight-path loop gets slower on the heavier airframes (they respond to the elevator with a longer lag)
    qCmd = this.holding || this.ap.on ? clamp(holdErr * 1.1 * ko, -3.5 * DEG, 3.5 * DEG) : sp * 6 * DEG;
    qCmd += turnQ;
    // protections: no nose-up command in a stall warning, and not above the speed limit
    if (ac.stallWarning) qCmd = Math.min(qCmd, -3 * DEG);
    if (ac.cas > (ac.def.limits.vne - 8) * KT) qCmd = Math.min(qCmd, 0);   // no nose-up command at the speed limit
    const wantI = Math.abs(sp) <= 0.04 || this.ap.on;
    const e = qCmd - q;
    if (wantI) this.pitchI = clamp(this.pitchI + 0.55 * ko * ko * (holdErr) * dt + 0.10 * e * dt, -0.5, 0.5);
    const fb = clamp((5.0 / k) * e + this.pitchI, -1, 1);
    // blend to the direct law below about 50 ft: stick + the trim the integrator found
    const w = clamp((ac.agl - 8) / 8, 0, 1);
    c.pitch = clamp(w * fb + (1 - w) * clamp(directPitch + this.pitchI, -1, 1), -1, 1);

    // roll: bank angle command through a roll-rate loop (max 12 deg/s)
    const pCmd = clamp((bankCmd - phi) * 1.5, -12 * DEG, 12 * DEG);
    c.roll = clamp((2.6 / k) * (pCmd - p), -1, 1);
    return true;
  }
}
