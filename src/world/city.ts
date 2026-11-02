// Procedural city fill for Edinburgh: the building data used by the game covers only the airport, so the city to the
// east is filled with generated blocks on the land-cover "built-up" cells. Illustrative, NOT the real buildings: heights
// rise towards the centre (with some tall towers), blocks sit on a street grid, and nothing is placed on water.

import { World, LC } from './world';
import { LocalProjection, EGPH_ORIGIN } from './geo';
import type { Building } from './obstacles';

const hash = (a: number, b: number, s = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 144665231);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const EDINBURGH_CENTRE = { lat: 55.9533, lon: -3.1883 };

export function generateCity(world: World, radius = 8500, cell = 58, isBuilt: (e: number, n: number) => boolean = (e, n) => world.landAt(e, n) === LC.BUILT): Building[] {
  const proj = new LocalProjection(EGPH_ORIGIN.lat, EGPH_ORIGIN.lon);
  const c = proj.forward(EDINBURGH_CENTRE.lat, EDINBURGH_CENTRE.lon);
  const yaw = (20 * Math.PI) / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const out: Building[] = [];
  const n = Math.ceil(radius / cell);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      // cell centre on a street grid rotated 20 degrees (the New Town grid)
      const ox = i * cell + (hash(i, j, 1) - 0.5) * 6, oy = j * cell + (hash(i, j, 2) - 0.5) * 6;
      const d = Math.hypot(ox, oy);
      if (d > radius) continue;
      const e = c.east + ox * cy - oy * sy, nn = c.north + ox * sy + oy * cy;
      if (Math.hypot(e, nn) < 3200) continue; // keep the airport's surroundings as they are
      if (!isBuilt(e, nn)) continue;
      const dk = d / 1000;
      const occ = dk < 1.8 ? 0.98 : dk < 3.5 ? 0.92 : dk < 6 ? 0.85 : 0.75;
      if (hash(i, j, 3) > occ) continue;
      const hg = world.heightAt(e, nn);
      if (hg < 1.5) continue; // the Firth of Forth
      // footprint: 30-50 m rectangles inside the cell, aligned with the grid
      const w = 28 + hash(i, j, 4) * 22, l = 28 + hash(i, j, 5) * 22;
      const hw = w / 2, hl = l / 2;
      const r = hash(i, j, 6), r2 = r * r;
      let h: number;
      if (dk < 1.8) h = 24 + r2 * r * 80 + (hash(i, j, 7) < 0.06 ? 55 + hash(i, j, 8) * 60 : 0); // centre: tall blocks and towers
      else if (dk < 3.5) h = 16 + r2 * 46 + (hash(i, j, 7) < 0.02 ? 40 : 0);
      else if (dk < 6) h = 11 + r2 * 28;
      else h = 8 + r * 14;
      const pts = new Float32Array(8);
      const corners: [number, number][] = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]]; // counter-clockwise
      let minH = Infinity, maxH = -Infinity;
      corners.forEach(([x, y], k) => {
        const px = c.east + (ox + x) * cy - (oy + y) * sy, py = c.north + (ox + x) * sy + (oy + y) * cy;
        pts[2 * k] = px; pts[2 * k + 1] = py;
        const hh = world.heightAt(px, py); minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
      });
      out.push({ pts, base: minH - 1, top: maxH + h, minE: Math.min(pts[0], pts[2], pts[4], pts[6]), maxE: Math.max(pts[0], pts[2], pts[4], pts[6]), minN: Math.min(pts[1], pts[3], pts[5], pts[7]), maxN: Math.max(pts[1], pts[3], pts[5], pts[7]) });
    }
  }
  return out;
}
