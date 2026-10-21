// Small, allocation-light vector / quaternion maths for the flight model.
// The simulation core deliberately does not depend on three.js so it can run
// headless (tests, future native ports) and deterministically.
//
// Conventions used throughout the flight model:
//   World frame: local NED (x = north, y = east, z = down), metres, origin at the
//                EGPH aerodrome reference point at 0 m MSL.
//   Body frame:  FRD (x = forward, y = right wing, z = down), origin at the CG.
//   Quaternion q rotates body-frame vectors into the world frame.

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  static of(x: number, y: number, z: number) { return new Vec3(x, y, z); }
  clone() { return new Vec3(this.x, this.y, this.z); }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: Vec3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v: Vec3) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v: Vec3) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s: number) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  addScaled(v: Vec3, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  addIn(v: Vec3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: Vec3) {
    return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  norm() { const l = this.len(); return l > 1e-12 ? this.scale(1 / l) : new Vec3(); }
  neg() { return new Vec3(-this.x, -this.y, -this.z); }
}

export class Quat {
  constructor(public w = 1, public x = 0, public y = 0, public z = 0) {}
  clone() { return new Quat(this.w, this.x, this.y, this.z); }

  /** Aerospace 3-2-1 Euler (yaw psi, pitch theta, roll phi), radians. */
  static fromEuler(phi: number, theta: number, psi: number) {
    const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
    const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
    const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
    return new Quat(
      cr * cp * cy + sr * sp * sy,
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
    );
  }

  /** Returns [phi (roll), theta (pitch), psi (heading)] in radians. */
  toEuler(): [number, number, number] {
    const { w, x, y, z } = this;
    const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const s = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
    const theta = Math.asin(s);
    const psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return [phi, theta, psi];
  }

  mul(q: Quat) {
    return new Quat(
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
    );
  }

  normalize() {
    const l = Math.hypot(this.w, this.x, this.y, this.z);
    this.w /= l; this.x /= l; this.y /= l; this.z /= l;
    return this;
  }

  /** body -> world */
  rotate(v: Vec3) {
    const { w, x, y, z } = this;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return new Vec3(
      v.x + w * tx + (y * tz - z * ty),
      v.y + w * ty + (z * tx - x * tz),
      v.z + w * tz + (x * ty - y * tx),
    );
  }

  /** world -> body */
  invRotate(v: Vec3) {
    return new Quat(this.w, -this.x, -this.y, -this.z).rotate(v);
  }

  /** Integrate body angular rate omega (rad/s) over dt. */
  integrate(omega: Vec3, dt: number) {
    const ang = omega.len() * dt;
    if (ang < 1e-12) return this;
    const ax = omega.scale(1 / omega.len());
    const s = Math.sin(ang / 2);
    const dq = new Quat(Math.cos(ang / 2), ax.x * s, ax.y * s, ax.z * s);
    const r = this.mul(dq).normalize();
    this.w = r.w; this.x = r.x; this.y = r.y; this.z = r.z;
    return this;
  }
}

/** Diagonal-plus-Ixz inertia tensor typical for aircraft (symmetric about x-z plane). */
export class Inertia {
  constructor(public ixx: number, public iyy: number, public izz: number, public ixz = 0) {}
  mul(w: Vec3) {
    return new Vec3(this.ixx * w.x - this.ixz * w.z, this.iyy * w.y, -this.ixz * w.x + this.izz * w.z);
  }
  solve(m: Vec3) {
    // Inverse of [[ixx,0,-ixz],[0,iyy,0],[-ixz,0,izz]]
    const det = this.ixx * this.izz - this.ixz * this.ixz;
    return new Vec3(
      (this.izz * m.x + this.ixz * m.z) / det,
      m.y / this.iyy,
      (this.ixz * m.x + this.ixx * m.z) / det,
    );
  }
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const KT = 0.514444; // m/s per knot
export const FT = 0.3048;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Exponential approach of current toward target with time constant tau. */
export const approach = (cur: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
/** Rate-limited move toward target. */
export const moveToward = (cur: number, target: number, maxStep: number) =>
  Math.abs(target - cur) <= maxStep ? target : cur + Math.sign(target - cur) * maxStep;

/** Piecewise-linear table lookup with end clamping. xs must be ascending. */
export function interp(xs: readonly number[], ys: readonly number[], x: number) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}

/** Deterministic PRNG (mulberry32) so turbulence and tests are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample using Box-Muller. */
export function gauss(r: () => number) {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
