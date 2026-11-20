// Flight replay: the last minutes of the flight are recorded 20 times a second (pose, velocity, control surfaces, gear, flaps, lights, time of day) and can be
// played back from any camera, scrubbed, slowed down or sped up, and saved to / loaded from a file. Playback only draws the recorded pose (the flight model
// is paused), so it is exactly what happened. Pure logic: no rendering here, so it is testable headless.

export interface ReplayFrame {
  /** Simulated seconds since the start of the recording. */
  t: number;
  /** Position NED (m), attitude quaternion (w, x, y, z), velocity NED (m/s). */
  p: [number, number, number]; q: [number, number, number, number]; v: [number, number, number];
  /** Gear extension 0..1, flap angle (rad), spoiler 0..1, elevator, aileron L, aileron R, rudder (rad), throttle 0..1. */
  gear: number; flap: number; spoiler: number; el: number; al: number; ar: number; rud: number; thr: number;
  /** Bit mask: 1 landing light, 2 beacon, 4 strobes, 8 nav lights, 16 taxi light, 32 reverse thrust, 64 gear lever down. Time of day (h). */
  bits: number; tod: number;
}
export interface Replay {
  version: 1; aircraft: string; airport: string; dayOfYear: number; cloud: string; windDirection: number; windSpeed: number; qnh: number; temperatureC: number;
  frames: ReplayFrame[];
}

export const REPLAY_HZ = 20;
export const REPLAY_MAX_SECONDS = 20 * 60;

const r = (x: number, d: number) => { const k = 10 ** d; return Math.round(x * k) / k; };

/** The state of the aircraft that the recorder needs; filled in by the game each time it records. */
export interface ReplaySource {
  pos: { x: number; y: number; z: number }; q: { w: number; x: number; y: number; z: number }; vel: { x: number; y: number; z: number };
  gearExt: number; flap: number; spoiler: number; elevator: number; aileronL: number; aileronR: number; rudder: number;
}

export class ReplayRecorder {
  frames: ReplayFrame[] = [];
  private last = -1e9;
  constructor(public maxSeconds = REPLAY_MAX_SECONDS) {}
  get duration() { return this.frames.length ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0; }
  clear() { this.frames = []; this.last = -1e9; }
  /** Call every frame with the simulated time; records at REPLAY_HZ. */
  record(t: number, a: ReplaySource, thr: number, bits: number, tod: number) {
    if (t < this.last) this.clear();   // time went backwards (a restart): start over
    if (t - this.last < 1 / REPLAY_HZ - 1e-6) return;
    this.last = t;
    this.frames.push({ t: r(t, 3), p: [r(a.pos.x, 2), r(a.pos.y, 2), r(a.pos.z, 2)], q: [r(a.q.w, 5), r(a.q.x, 5), r(a.q.y, 5), r(a.q.z, 5)], v: [r(a.vel.x, 2), r(a.vel.y, 2), r(a.vel.z, 2)],
      gear: r(a.gearExt, 3), flap: r(a.flap, 4), spoiler: r(a.spoiler, 3), el: r(a.elevator, 4), al: r(a.aileronL, 4), ar: r(a.aileronR, 4), rud: r(a.rudder, 4), thr: r(thr, 3), bits, tod: r(tod, 4) });
    const cut = t - this.maxSeconds; let n = 0;
    while (n < this.frames.length - 2 && this.frames[n + 1].t < cut) n++;
    if (n > 0) this.frames.splice(0, n);
  }
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Frame at time `t` (clamped to the recording), interpolated between the two neighbours (attitude by normalised lerp). */
export function sampleReplay(frames: ReplayFrame[], t: number): ReplayFrame {
  const n = frames.length;
  if (n === 0) throw new Error('empty replay');
  if (t <= frames[0].t || n === 1) return frames[0];
  if (t >= frames[n - 1].t) return frames[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
  const a = frames[lo], b = frames[hi], u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const dot = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3], s = dot < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => lerp(a.q[i], s * b.q[i], u)); const qn = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const L = (x: number, y: number) => lerp(x, y, u);
  return {
    t, p: [L(a.p[0], b.p[0]), L(a.p[1], b.p[1]), L(a.p[2], b.p[2])], q: q.map((x) => x / qn) as [number, number, number, number], v: [L(a.v[0], b.v[0]), L(a.v[1], b.v[1]), L(a.v[2], b.v[2])],
    gear: L(a.gear, b.gear), flap: L(a.flap, b.flap), spoiler: L(a.spoiler, b.spoiler), el: L(a.el, b.el), al: L(a.al, b.al), ar: L(a.ar, b.ar), rud: L(a.rud, b.rud), thr: L(a.thr, b.thr),
    bits: u < 0.5 ? a.bits : b.bits, tod: L(a.tod, b.tod),
  };
}

const fin = (x: unknown, lim = 1e7) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-lim, Math.min(lim, x)) : 0);
const tup = <N extends number>(a: unknown, n: N, lim: number): number[] | null => (Array.isArray(a) && a.length === n ? a.map((x) => fin(x, lim)) : null);

/** Parses and validates a replay file (untrusted input): returns null if it is not a usable replay. */
export function parseReplay(text: string): Replay | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.version !== 1 || !Array.isArray(o.frames) || o.frames.length < 2 || o.frames.length > REPLAY_HZ * 3600) return null;
  const frames: ReplayFrame[] = [];
  let prev = -1e9;
  for (const f of o.frames as Record<string, unknown>[]) {
    const p = tup(f?.p, 3, 3e6), q = tup(f?.q, 4, 1.01), v = tup(f?.v, 3, 1000);
    if (!p || !q || !v) return null;
    const t = fin(f.t, 1e6); if (t < prev) return null; prev = t;
    const qn = Math.hypot(q[0], q[1], q[2], q[3]); if (qn < 0.5) return null;
    frames.push({ t, p: p as ReplayFrame['p'], q: q.map((x) => x / qn) as ReplayFrame['q'], v: v as ReplayFrame['v'], gear: fin(f.gear, 1), flap: fin(f.flap, 3), spoiler: fin(f.spoiler, 1), el: fin(f.el, 3), al: fin(f.al, 3), ar: fin(f.ar, 3), rud: fin(f.rud, 3), thr: fin(f.thr, 1), bits: Math.max(0, Math.min(255, Math.round(fin(f.bits, 255)))), tod: fin(f.tod, 48) });
  }
  const s = (x: unknown, n = 12) => String(x ?? '').slice(0, n).replace(/[^A-Za-z0-9_-]/g, '');
  return { version: 1, aircraft: s(o.aircraft), airport: s(o.airport, 6), dayOfYear: Math.round(fin(o.dayOfYear, 366)), cloud: s(o.cloud, 4), windDirection: fin(o.windDirection, 360), windSpeed: fin(o.windSpeed, 200),
    qnh: Math.max(900, Math.min(1100, fin(o.qnh, 1100))), temperatureC: fin(o.temperatureC, 70), frames };
}
