// Sea state: one set of travelling waves used by BOTH the rendered water surface (GLSL copy in render/seaSurface.ts) and the flight
// model (floating, drag, splashes), so the water you see is the water the aircraft touches. Heights in metres above sea level.
export interface WaveDef { dx: number; dy: number; L: number; A: number }
// directions are (east, north); wavelength L and amplitude A at sea state 1
export const WAVES: WaveDef[] = [
  { dx: 0.95, dy: 0.31, L: 170, A: 0.85 },
  { dx: 0.62, dy: -0.78, L: 83, A: 0.45 },
  { dx: -0.30, dy: 0.95, L: 41, A: 0.24 },
  { dx: 0.80, dy: 0.60, L: 22, A: 0.12 },
];
const G = 9.80665, TWO_PI = Math.PI * 2;
export const sea = { t: 0, amp: 1 };
export const waveOmega = (L: number) => Math.sqrt(G * TWO_PI / L);
/** Wave amplitude scale from the wind (knots): calm 0.4 .. gale 2.6. */
export const seaAmpFromWind = (windKt: number) => Math.min(2.6, 0.4 + windKt * 0.07);
/** Water surface height at (east, north). */
export function seaHeight(e: number, n: number, t = sea.t, amp = sea.amp): number {
  let h = 0;
  for (const w of WAVES) { const k = TWO_PI / w.L; h += w.A * Math.sin(k * (w.dx * e + w.dy * n) - waveOmega(w.L) * t); }
  return h * amp;
}
