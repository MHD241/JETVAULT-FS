// Vertical air motion for gliders: thermals and ridge (slope) lift.
//
//  - Thermals: a hashed grid of columns (~1.7 km spacing) that wax and wane over ~15 min,
//    strength scaled by the sun's height and cloud cover, a Gaussian updraught core with a
//    ring of sink around it, a boundary-layer height profile and drift with the wind.
//  - Ridge lift: wind forced up or down the terrain slope, decaying with height above ground.
// The numbers are engineering estimates in the range gliding texts quote (core 1.5-4 m/s,
// 100-250 m radius, boundary layer 1-2 km); there is no real weather data behind them.

import { WeatherSettings, WindModel, CloudCover } from './weather';

const CELL = 1700;
const COVER: Record<CloudCover, number> = { SKC: 0, FEW: 0.18, SCT: 0.4, BKN: 0.7, OVC: 0.97 };

function hash(i: number, j: number, k: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export interface LiftWorld {
  /** Terrain height, m (east, north). */
  heightAt(east: number, north: number): number;
}

export class LiftField {
  /** Multiplier on all lift (1 = default; 0 disables). */
  strength = 1;
  constructor(private world: LiftWorld, private weather: () => WeatherSettings, private wind: WindModel, private time: () => number) {}

  /** Sun strength 0..1 from the local time of day (Scottish latitude, mid-season). */
  sunStrength(): number {
    const w = this.weather();
    const t = w.timeOfDay;
    const s = Math.max(0, Math.sin((Math.PI * (t - 7)) / 11));
    return s * (1 - 0.55 * COVER[w.cloudCover]);
  }

  /** Vertical air velocity (m/s, positive up) at a position. */
  at(north: number, east: number, _alt: number, agl: number): number {
    if (this.strength <= 0) return 0;
    return this.strength * (this.thermals(north, east, agl) + this.ridge(north, east, agl));
  }

  private thermals(north: number, east: number, agl: number): number {
    const sun = this.sunStrength();
    if (sun < 0.05 || agl < 5) return 0;
    const zi = 700 + 1300 * sun; // boundary layer depth AGL, m
    if (agl > zi * 1.05) return -0.1 * sun;
    const t = this.time();
    const wm = this.wind.meanWind(Math.min(agl, 400)); // NED: x north, y east
    // thermals lean downwind as they rise (~3 m/s ascent)
    const lean = Math.min(agl, zi) / 3;
    const ci = Math.floor((north - wm.x * lean) / CELL), cj = Math.floor((east - wm.y * lean) / CELL);
    const zr = Math.min(agl / zi, 1);
    const prof = Math.max(0, Math.pow(Math.max(zr, 0.001), 1 / 3) * (1 - 1.1 * zr)) / 0.45;
    let w = -0.25 * sun; // broad subsidence between columns
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (hash(i, j, 1) > 0.72) continue;
        const life = 800 + 500 * hash(i, j, 5);
        const ph = (t / life + hash(i, j, 6)) % 1;
        const inten = Math.pow(Math.sin(Math.PI * ph), 0.8);
        const cn = (i + 0.15 + 0.7 * hash(i, j, 2)) * CELL + wm.x * lean;
        const ce = (j + 0.15 + 0.7 * hash(i, j, 3)) * CELL + wm.y * lean;
        const R = (90 + 140 * hash(i, j, 4)) * (0.7 + 0.5 * zr);
        const d = Math.hypot(north - cn, east - ce);
        if (d > 4.5 * R) continue;
        const w0 = (1.4 + 2.6 * hash(i, j, 7)) * sun * inten;
        const core = Math.exp(-((d / R) * (d / R)));
        const ring = 0.2 * Math.exp(-(((d - 2.3 * R) / (0.9 * R)) * ((d - 2.3 * R) / (0.9 * R))));
        w += w0 * prof * (core - ring);
      }
    }
    return w;
  }

  private ridge(north: number, east: number, agl: number): number {
    const w = this.weather();
    if (w.windSpeed < 3) return 0;
    const m = this.wind.meanWind(10);
    const spd = Math.hypot(m.x, m.y);
    if (spd < 1) return 0;
    const ux = m.x / spd, uy = m.y / spd; // direction the air moves (north, east)
    // effective slope over ~350 m upwind to 100 m downwind of the aircraft
    const a = this.world.heightAt(east - uy * 250, north - ux * 250);
    const b = this.world.heightAt(east + uy * 100, north + ux * 100);
    const slope = (b - a) / 350;
    const H = 150 + 6 * Math.max(0, w.windSpeed); // lift depth above the slope
    const lift = spd * slope * Math.exp(-Math.max(agl, 0) / H);
    return Math.max(-4, Math.min(4, lift));
  }
}

