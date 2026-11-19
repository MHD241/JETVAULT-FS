// Keyframed flights for the Director: the aircraft follows a fixed table of keyframes in RUNWAY coordinates (metres along the runway from the threshold,
// metres right of the centreline, height of the datum above the ground, pitch, roll). The path is the same every time, exactly, and it cannot stall:
// the flight model only supplies lights, gear and engine sound. Each physics step the pose and velocity are written straight into the aircraft.
import { Vec3, Quat, DEG, KT } from '../core/math';
import { Simulation, PHYSICS_DT } from './simulation';
import { runwayEnd } from '../world/airport';

export interface Key { t: number; s: number; c: number; h: number; pitch: number; roll: number }
export type FlightKind = 'takeoff' | 'landing' | 'cruise';

/** Catmull-Rom (Hermite) interpolation of a keyframe table; tangents from the neighbouring keys, so position and velocity are continuous. */
export function sample(keys: Key[], t: number): { k: Key; v: { s: number; c: number; h: number } } {
  const n = keys.length;
  if (t <= keys[0].t) t = keys[0].t;
  let i = 0; while (i < n - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1], p = keys[Math.max(0, i - 1)], q = keys[Math.min(n - 1, i + 2)];
  const dt = b.t - a.t, u = Math.min(1, Math.max(0, (t - a.t) / dt));
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const f = (key: 's' | 'c' | 'h' | 'pitch' | 'roll') => {
    const m0 = (b[key] - p[key]) / Math.max(1e-6, b.t - p.t) * (i === 0 ? 0 : 1) + (i === 0 ? (b[key] - a[key]) / dt : 0);
    const m1 = (q[key] - a[key]) / Math.max(1e-6, q.t - a.t) * (i + 2 > n - 1 ? 0 : 1) + (i + 2 > n - 1 ? (b[key] - a[key]) / dt : 0);
    const val = h00 * a[key] + h10 * dt * m0 + h01 * b[key] + h11 * dt * m1;
    const d = ((6 * u2 - 6 * u) * a[key] + (3 * u2 - 4 * u + 1) * dt * m0 + (-6 * u2 + 6 * u) * b[key] + (3 * u2 - 2 * u) * dt * m1) / dt;
    return [val, d] as const;
  };
  const [s, ds] = f('s'), [c, dc] = f('c'), [h, dh] = f('h'), [pitch] = f('pitch'), [roll] = f('roll');
  return { k: { t, s, c, h, pitch, roll }, v: { s: ds, c: dc, h: dh } };
}

/** The tables. `v` = approach speed m/s, `g` = datum height on its wheels (m), `off` = the first metres of the runway used. */
export function landingKeys(v: number, g: number, pitchApp: number, td: number): Key[] {
  const tg = Math.tan(3 * DEG), dA = 1500, flare = 4.5 * v, tB = (dA - flare) / v;
  const k: Key[] = [];
  const add = (t: number, s: number, h: number, pitch: number) => k.push({ t, s, c: 0, h, pitch, roll: 0 });
  add(0, td - dA, dA * tg + g, pitchApp);
  add(tB, td - flare, flare * tg + g, pitchApp);
  add(tB + 2.2, td - flare + 2.2 * v * 0.99, g + flare * tg * 0.36, pitchApp + 1.2);   // the flare: sink rate bleeds off
  add(tB + 4.5, td, g, pitchApp + 2.2);                                                // touchdown
  const t0 = tB + 4.5, v0 = v * 0.92;
  add(t0 + 2.5, td + v0 * 2.5, g, 0.4);                                               // nose lowered
  const a = 2.6;
  for (let tau = 8; tau <= 40; tau += 8) { const x = Math.min(tau, v0 / a); add(t0 + tau, td + v0 * x - 0.5 * a * x * x + (tau > v0 / a ? 0 : 0), g, 0); }
  return k;
}
export function takeoffKeys(vr: number, g: number, s0: number, pitchClimb: number): Key[] {
  const a = 1.9, tr = vr / a, k: Key[] = [];
  const add = (t: number, s: number, h: number, pitch: number) => k.push({ t, s, c: 0, h, pitch, roll: 0 });
  // acceleration on the ground, then rotation (4 s), lift-off and a climb at about 7.5 degrees; dense keys keep the interpolation true to the physics
  for (let t = 0; t <= tr; t += 2) add(t, s0 + 0.5 * a * t * t, g, 0);
  const sr = s0 + 0.5 * a * tr * tr, slope = Math.tan(7.5 * DEG);
  let s = sr, h = g, v = vr;
  for (let t = tr + 2; t <= tr + 60; t += 2) {
    const q = (t - tr) / 6;                                  // 0..1 over the first 6 s: rotate and lift off
    v += 0.7 * 2; s += v * 2;
    h = q < 0.4 ? g : q < 1 ? h + (v * 2) * slope * (q - 0.3) : h + v * 2 * slope;
    add(t, s, h, q < 1 ? 11 * Math.min(1, q * 1.4) : pitchClimb);
  }
  return k;
}
export function cruiseKeys(v: number, h: number, pitch: number): Key[] {
  return [0, 20, 40, 60].map((t) => ({ t, s: v * t, c: 0, h, pitch, roll: 0 }));
}

/** Flies the keyframes: call `step()` once per physics step (Simulation.preStep). */
export class KeyframeFlight {
  t = 0; done = false; phase = 'keyframes';
  /** Set when the path runs into a building (the flight stops there and the aircraft is marked crashed). */
  collided = false;
  private keys: Key[]; private ux: number; private uy: number; private ground: number; private hdg: number;
  private kind: FlightKind;
  constructor(public sim: Simulation, kind: FlightKind, ident: string, opts: { cruiseAglFt?: number; heading?: number; east?: number; north?: number; altMsl?: number } = {}) {
    const ac = sim.aircraft, def = ac.def, P = def.profile;
    const { end, other } = runwayEnd(sim.world.airport, ident);
    this.kind = kind;
    this.hdg = kind === 'cruise' ? (opts.heading ?? 0) : Math.atan2(other.x - end.x, other.y - end.y);
    this.ux = Math.sin(this.hdg); this.uy = Math.cos(this.hdg);
    this.ground = end.elev + def.spawnHeight + 0.05;
    const vApp = (P.approachKias + 0) * KT;
    if (kind === 'landing') this.keys = landingKeys(vApp, def.spawnHeight + 0.05, P.approachPitchDeg, end.displaced + 320);
    else if (kind === 'takeoff') this.keys = takeoffKeys((def.limits.vs1 + 12) * KT * 1.02, def.spawnHeight + 0.05, end.displaced + 15, 11);
    else { this.keys = cruiseKeys(210 * KT * 0.8, 0, 2); this.ground = (opts.altMsl ?? 600); }
    if (kind === 'cruise') { this.ux = Math.sin(this.hdg); this.uy = Math.cos(this.hdg); this.x0 = opts.east ?? 0; this.y0 = opts.north ?? 0; }
    else { this.x0 = end.x; this.y0 = end.y; }
    const c = sim.controls;
    c.landingLight = true; c.beacon = true; c.strobes = true; c.navLights = true; c.parkingBrake = false;
    this.apply(0, 0);
  }
  private x0 = 0; private y0 = 0;
  step() {
    const ac = this.sim.aircraft, c = this.sim.controls;
    if (this.collided) { ac.crashed = true; return; }
    this.t += PHYSICS_DT;
    const total = this.keys[this.keys.length - 1].t;
    this.apply(Math.min(this.t, total), PHYSICS_DT);
    ac.crashed = this.collided;
    // gear, flaps, engines, spoilers follow the table's story
    const { k } = sample(this.keys, Math.min(this.t, total));
    if (this.kind === 'landing') {
      const down = this.t >= this.keys[3].t;   // touchdown is the fourth key
      c.gearDown = true; c.flapLever = ac.def.profile.approachFlapLever;
      c.throttle = down ? 0.6 : ac.def.profile.approachThrottle; c.speedbrake = down ? 1 : 0; c.reverse = down;
    } else if (this.kind === 'takeoff') {
      c.throttle = 1; c.flapLever = k.h > 80 ? 0 : ac.def.profile.takeoffFlapLever; c.gearDown = k.h < ac.def.spawnHeight + 12;
    } else { c.throttle = 0.65; c.gearDown = false; c.flapLever = 0; }
    this.done = this.t >= total;
  }
  private apply(t: number, dt: number) {
    const ac = this.sim.aircraft;
    const { k, v } = sample(this.keys, t);
    const east = this.x0 + this.ux * k.s + this.uy * k.c, north = this.y0 + this.uy * k.s - this.ux * k.c;
    const def = this.sim.aircraft.def, world = this.sim.world;
    let alt = (this.kind === 'cruise' ? this.ground : this.ground - (def.spawnHeight + 0.05)) + k.h;
    // ground: the wheels never go below the terrain or runway surface under the aircraft, and a cruise keeps 60 m above it
    const gh = world.heightAt(east, north);
    alt = Math.max(alt, gh + (this.kind === 'cruise' ? 60 : def.spawnHeight + 0.05));
    // collision: the datum inside a building ends the flight
    if (!this.collided && world.obstacles.hit(east, north, alt) >= 0) this.collided = true;
    if (this.kind !== 'cruise') k.h = Math.max(k.h, this.sim.aircraft.def.spawnHeight + 0.05);
    ac.q = Quat.fromEuler(k.roll * DEG, k.pitch * DEG, this.hdg);
    ac.pos = new Vec3(north, east, -alt);
    ac.vel = new Vec3(this.uy * v.s - this.ux * v.c, this.ux * v.s + this.uy * v.c, -v.h);
    ac.omega = new Vec3();
    void dt;
  }
}
