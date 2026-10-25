// Retrieval buggy for the glider field: a simple kinematic car (bicycle model) driven by the
// player to hook up a landed glider and tow it back to a launch point. Positions are local ENU
// (east, north), heading is a compass angle in radians (0 = north, clockwise).

import { DEG, clamp, moveToward } from '../core/math';
import type { AirportData } from '../world/airport';

export const BUGGY_WHEELBASE = 2.4;
export const BUGGY_HITCH = 2.3; // rear tow hitch behind the centre, m
export const BUGGY_MAX_SPEED = 9; // m/s (about 20 mph, a sensible field speed)

export class Buggy {
  east = 0; north = 0; heading = 0; speed = 0;
  /** Steering wheel position, -1 (left) .. +1 (right). */
  steer = 0;
  towing = false;

  place(east: number, north: number, heading: number) {
    this.east = east; this.north = north; this.heading = heading; this.speed = 0; this.steer = 0; this.towing = false;
  }

  /** speedCmd in m/s (forward only), brake stops it quickly. */
  step(dt: number, speedCmd: number, steer: number, brake: boolean) {
    this.steer = clamp(steer, -1, 1);
    const target = brake ? 0 : clamp(speedCmd, 0, BUGGY_MAX_SPEED) * (this.towing ? 0.7 : 1);
    this.speed = moveToward(this.speed, target, (brake ? 6 : target > this.speed ? 2.2 : 3) * dt);
    this.heading += (this.speed / BUGGY_WHEELBASE) * Math.tan(this.steer * 32 * DEG) * dt;
    this.east += Math.sin(this.heading) * this.speed * dt;
    this.north += Math.cos(this.heading) * this.speed * dt;
  }

  hitch(): { east: number; north: number } {
    return { east: this.east - Math.sin(this.heading) * BUGGY_HITCH, north: this.north - Math.cos(this.heading) * BUGGY_HITCH };
  }
}

export interface LaunchPoint { east: number; north: number; heading: number; ident: string }

/** Winch launch points: just inside each runway end, facing along the runway (where the "Runway N winch launch" start puts the glider). */
export function launchPoints(ap: AirportData): LaunchPoint[] {
  const out: LaunchPoint[] = [];
  for (const rw of ap.runways) {
    for (let i = 0; i < 2; i++) {
      const end = rw.ends[i], other = rw.ends[1 - i];
      const L = Math.hypot(other.x - end.x, other.y - end.y) || 1;
      const t = (end.displaced + 15) / L;
      out.push({ east: end.x + (other.x - end.x) * t, north: end.y + (other.y - end.y) * t, heading: Math.atan2(other.x - end.x, other.y - end.y), ident: end.ident });
    }
  }
  return out;
}

/** The launch point within `radius` metres of (east, north), if any. */
export function nearestLaunchPoint(pts: LaunchPoint[], east: number, north: number, radius = 45): LaunchPoint | null {
  let best: LaunchPoint | null = null, bd = radius;
  for (const p of pts) { const d = Math.hypot(p.east - east, p.north - north); if (d < bd) { bd = d; best = p; } }
  return best;
}
