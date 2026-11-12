// Sea state: ONE spectrum-based set of travelling waves used by BOTH the drawn water surface (render/seaSurface.ts, same numbers in GLSL)
// and the flight model (floating, drag, splashes). 48 waves from 6 m to 420 m across a wind-driven spread of directions with random
// phases, steepness following a rough ocean spectrum (long swells gentle, short chop steeper). Heights in metres above sea level.
export interface WaveDef { dx: number; dy: number; L: number; A: number; k: number; w: number; phi: number; Q: number }
const G = 9.80665, TWO_PI = Math.PI * 2;
export const waveOmega = (L: number) => Math.sqrt(G * TWO_PI / L);
export const WIND_DIR = (25 * Math.PI) / 180;   // waves travel towards this heading (east-of-north not needed: (dx,dy) are east, north components)

function build(n = 48): WaveDef[] {
  let seed = 90210; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out: WaveDef[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), L = 6 * Math.pow(70, t);                    // 6 m .. 420 m, geometric
    const steep = L > 120 ? 0.016 : L > 40 ? 0.026 : 0.042;            // a*k
    const A = (steep * (0.55 + 0.45 * rnd()) * L) / TWO_PI;
    const spread = 0.25 + 0.9 * Math.pow(1 - t, 1.5);                  // short chop comes from more directions than the long swell
    const th = WIND_DIR + (rnd() * 2 - 1) * spread;
    const k = TWO_PI / L;
    out.push({ dx: Math.cos(th), dy: Math.sin(th), L, A, k, w: waveOmega(L), phi: rnd() * TWO_PI, Q: Math.min(1, 0.9 / (n * k * A)) });
  }
  return out;
}
export const WAVES: WaveDef[] = build();
export const sea = { t: 0, amp: 1 };
/** Wave amplitude scale from the wind (knots): calm 1.0 .. gale 4.6. */
export const seaAmpFromWind = (windKt: number) => Math.min(4.6, 1.0 + windKt * 0.12);

/** Water surges from impacts: an expanding ring of raised water that travels outward and decays. */
export interface Surge { e: number; n: number; t0: number; s: number }
export const surges: Surge[] = [];
export const SURGE_SPEED = 40;
export function addSurge(e: number, n: number, strength: number) { surges.push({ e, n, t0: sea.t, s: strength }); while (surges.length > 4) surges.shift(); }
export function surgeHeight(r: number, a: number, s: number): number {
  if (a < 0) return 0;
  const front = SURGE_SPEED * a, w = 14 + 6 * a, x = (r - front) / w, env = Math.exp(-a / 12) / (1 + r / 60);
  const ramp = a < 1.6 ? (a / 1.6) * (a / 1.6) * (3 - 2 * a / 1.6) : 1;   // the water rises over ~1.6 s instead of jumping
  return ramp * (s * 14 * env * Math.exp(-x * x) * (1 - 0.45 * x) + s * 10 * Math.exp(-a * 0.9) * Math.exp(-(r * r) / (90 + 160 * a)));
}
/** Water surface height at (east, north). */
export function seaHeight(e: number, n: number, t = sea.t, amp = sea.amp): number {
  let h = 0;
  for (const w of WAVES) h += w.A * Math.sin(w.k * (w.dx * e + w.dy * n) - w.w * t + w.phi);
  h *= amp;
  for (const g of surges) { const a = t - g.t0; if (a > 40) continue; h += surgeHeight(Math.hypot(e - g.e, n - g.n), a, g.s); }
  return h;
}
