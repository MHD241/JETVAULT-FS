// Sea state: one set of travelling waves used by BOTH the rendered water surface (GLSL copy in render/seaSurface.ts) and the flight
// model (floating, drag, splashes), so the water you see is the water the aircraft touches. Heights in metres above sea level.
export interface WaveDef { dx: number; dy: number; L: number; A: number }
// directions are (east, north); wavelength L and amplitude A at sea state 1
export const WAVES: WaveDef[] = [
  { dx: 0.95, dy: 0.31, L: 170, A: 2.3 },
  { dx: 0.62, dy: -0.78, L: 83, A: 1.25 },
  { dx: -0.30, dy: 0.95, L: 41, A: 0.65 },
  { dx: 0.80, dy: 0.60, L: 22, A: 0.3 },
];
const G = 9.80665, TWO_PI = Math.PI * 2;
export const sea = { t: 0, amp: 1 };
/** Water surges from impacts: an expanding ring of raised water that travels outward and decays. */
export interface Surge { e: number; n: number; t0: number; s: number }
export const surges: Surge[] = [];
export const SURGE_SPEED = 40;                 // m/s the front travels
export function addSurge(e: number, n: number, strength: number) { surges.push({ e, n, t0: sea.t, s: strength }); while (surges.length > 4) surges.shift(); }
/** Height of one surge ring at distance r, age a: a crest that travels and spreads, decaying with age and distance. */
export function surgeHeight(r: number, a: number, s: number): number {
  if (a < 0) return 0;
  const front = SURGE_SPEED * a, w = 14 + 6 * a, x = (r - front) / w, env = Math.exp(-a / 12) / (1 + r / 60);
  const ramp = a < 1.6 ? (a / 1.6) * (a / 1.6) * (3 - 2 * a / 1.6) : 1;   // the water rises over ~1.6 s instead of jumping
  return ramp * (s * 14 * env * Math.exp(-x * x) * (1 - 0.45 * x) + s * 10 * Math.exp(-a * 0.9) * Math.exp(-(r * r) / (90 + 160 * a)));
}
export const waveOmega = (L: number) => Math.sqrt(G * TWO_PI / L);
/** Wave amplitude scale from the wind (knots): calm 1.0 .. gale 4.6. */
export const seaAmpFromWind = (windKt: number) => Math.min(4.6, 1.0 + windKt * 0.12);
/** Water surface height at (east, north). */
export function seaHeight(e: number, n: number, t = sea.t, amp = sea.amp): number {
  let h = 0;
  for (const w of WAVES) { const k = TWO_PI / w.L; h += w.A * Math.sin(k * (w.dx * e + w.dy * n) - waveOmega(w.L) * t); }
  h *= amp;
  for (const g of surges) { const a = t - g.t0; if (a > 40) continue; h += surgeHeight(Math.hypot(e - g.e, n - g.n), a, g.s); }
  return h;
}
