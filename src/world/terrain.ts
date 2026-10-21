// Terrain heightfield shared by the physics (ground contact) and the renderer.
//
// Grids are square, row 0 = north edge, column 0 = west edge, with sample (r, c) at
//   east  = -half + c * step
//   north = +half - r * step
// Each grid cell is split into two triangles along the NE-SW diagonal:
//   T1 = (NW, NE, SW), T2 = (NE, SE, SW)
// The renderer MUST triangulate identically (see render/terrainMesh.ts) so that the
// wheels touch exactly the surface that is drawn at full detail.

export interface GridMeta {
  n: number;
  half: number;
  step: number;
  scale: number;
}

export class HeightGrid {
  readonly n: number;
  readonly half: number;
  readonly step: number;
  readonly heights: Float32Array;

  constructor(meta: GridMeta, raw: Int16Array) {
    this.n = meta.n;
    this.half = meta.half;
    this.step = meta.step;
    this.heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.heights[i] = raw[i] * meta.scale;
  }

  contains(east: number, north: number, margin = 0) {
    return Math.abs(east) <= this.half - margin && Math.abs(north) <= this.half - margin;
  }

  at(r: number, c: number) {
    r = r < 0 ? 0 : r >= this.n ? this.n - 1 : r;
    c = c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
    return this.heights[r * this.n + c];
  }

  /** Height (m MSL) and upward surface normal (east, north, up) at a point. */
  sample(east: number, north: number, normalOut?: { e: number; n: number; u: number }): number {
    const fc = (east + this.half) / this.step;
    const fr = (this.half - north) / this.step;
    let c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0) c = 0; else if (c > this.n - 2) c = this.n - 2;
    if (r < 0) r = 0; else if (r > this.n - 2) r = this.n - 2;
    const u = Math.min(1, Math.max(0, fc - c)); // toward east
    const v = Math.min(1, Math.max(0, fr - r)); // toward south
    const i = r * this.n + c;
    const h00 = this.heights[i], h10 = this.heights[i + 1];
    const h01 = this.heights[i + this.n], h11 = this.heights[i + this.n + 1];
    let h: number, dhdu: number, dhdv: number;
    if (u + v <= 1) {
      dhdu = h10 - h00; dhdv = h01 - h00;
      h = h00 + dhdu * u + dhdv * v;
    } else {
      dhdu = h11 - h01; dhdv = h11 - h10;
      h = h11 - dhdu * (1 - u) - dhdv * (1 - v);
    }
    if (normalOut) {
      // dh/deast = dhdu/step ; dh/dnorth = -dhdv/step
      const ge = dhdu / this.step, gn = -dhdv / this.step;
      const l = Math.sqrt(ge * ge + gn * gn + 1);
      normalOut.e = -ge / l; normalOut.n = -gn / l; normalOut.u = 1 / l;
    }
    return h;
  }
}

/** Two-level terrain: high resolution core with a low resolution far field. */
export class Terrain {
  constructor(public hi: HeightGrid, public lo: HeightGrid | null = null) {}

  /** Ground elevation (m MSL) at local east/north. Normal is optional. */
  heightAt(east: number, north: number, normalOut?: { e: number; n: number; u: number }): number {
    if (this.hi.contains(east, north) || !this.lo) return this.hi.sample(east, north, normalOut);
    return this.lo.sample(east, north, normalOut);
  }
}

/** Flat terrain for unit tests. */
export function flatTerrain(elev = 0, half = 50000): Terrain {
  const n = 3;
  const raw = new Int16Array(n * n).fill(Math.round(elev * 10));
  return new Terrain(new HeightGrid({ n, half, step: half, scale: 0.1 }, raw));
}
