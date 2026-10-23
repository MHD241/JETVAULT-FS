// Building obstacles: extruded footprints (from Overture/OSM) indexed in a uniform grid.
// Used for aircraft-object collision and rendered as the same prisms, so what you see
// is what you hit.

export interface Building {
  /** Footprint, counter-clockwise, local [east, north] metres. */
  pts: Float32Array; // interleaved e,n
  base: number; // m MSL (lowest terrain under footprint)
  top: number; // m MSL
  minE: number; maxE: number; minN: number; maxN: number;
  /** Airport building class (set by styleAirportBuildings); 'terminal' and 'pier' render with glazing. */
  role?: 'terminal' | 'pier' | 'airside';
}

export class ObstacleIndex {
  private cells = new Map<number, number[]>();
  readonly buildings: Building[] = [];
  constructor(private cell = 100) {}

  private key(ix: number, iy: number) { return (ix + 32768) * 65536 + (iy + 32768); }

  add(b: Building) {
    const id = this.buildings.length;
    this.buildings.push(b);
    const c = this.cell;
    for (let ix = Math.floor(b.minE / c); ix <= Math.floor(b.maxE / c); ix++) {
      for (let iy = Math.floor(b.minN / c); iy <= Math.floor(b.maxN / c); iy++) {
        const k = this.key(ix, iy);
        let l = this.cells.get(k);
        if (!l) { l = []; this.cells.set(k, l); }
        l.push(id);
      }
    }
  }

  /** Returns the building containing the point (east, north, alt MSL), or -1. */
  hit(east: number, north: number, alt: number): number {
    const l = this.cells.get(this.key(Math.floor(east / this.cell), Math.floor(north / this.cell)));
    if (!l) return -1;
    for (const id of l) {
      const b = this.buildings[id];
      if (alt < b.base || alt > b.top) continue;
      if (east < b.minE || east > b.maxE || north < b.minN || north > b.maxN) continue;
      if (pointInPoly(b.pts, east, north)) return id;
    }
    return -1;
  }

  /** Buildings whose bounding box intersects the rectangle. */
  query(minE: number, minN: number, maxE: number, maxN: number): number[] {
    const out = new Set<number>();
    const c = this.cell;
    for (let ix = Math.floor(minE / c); ix <= Math.floor(maxE / c); ix++) {
      for (let iy = Math.floor(minN / c); iy <= Math.floor(maxN / c); iy++) {
        const l = this.cells.get(this.key(ix, iy));
        if (l) for (const id of l) out.add(id);
      }
    }
    return [...out];
  }
}

export function pointInPoly(pts: Float32Array, x: number, y: number): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i], yi = pts[2 * i + 1], xj = pts[2 * j], yj = pts[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Parses buildings.bin (see tools/build_geodata.py) and drapes them on the terrain. */
export function parseBuildings(
  buf: ArrayBuffer, heightAt: (e: number, n: number) => number, maxDist = Infinity,
): Building[] {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  let off = 4;
  const out: Building[] = [];
  for (let i = 0; i < count; i++) {
    const nv = dv.getUint16(off, true);
    const h = dv.getFloat32(off + 2, true);
    off += 6;
    const pts = new Float32Array(nv * 2);
    for (let k = 0; k < nv * 2; k++) pts[k] = dv.getFloat32(off + k * 4, true);
    off += nv * 8;
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (let k = 0; k < nv; k++) {
      const e = pts[2 * k], n = pts[2 * k + 1];
      if (e < minE) minE = e; if (e > maxE) maxE = e;
      if (n < minN) minN = n; if (n > maxN) maxN = n;
    }
    const cE = (minE + maxE) / 2, cN = (minN + maxN) / 2;
    if (Math.hypot(cE, cN) > maxDist) continue;
    // The DEM is a surface model that partly contains buildings already, so buildings
    // stand on the lowest ground under the footprint.
    let base = heightAt(cE, cN);
    for (let k = 0; k < nv; k++) base = Math.min(base, heightAt(pts[2 * k], pts[2 * k + 1]));
    out.push({ pts, base: base - 1, top: base + h, minE, maxE, minN, maxN });
  }
  return out;
}

/** Is a point within 3 m of the building's bounding box edge and footprint? (gates sit on the facade) */
function near(b: Building, x: number, y: number) {
  if (x < b.minE - 3 || x > b.maxE + 3 || y < b.minN - 3 || y > b.maxN + 3) return false;
  const n = b.pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = b.pts[2 * i], ay = b.pts[2 * i + 1], dx = b.pts[2 * j] - ax, dy = b.pts[2 * j + 1] - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < 3) return true;
  }
  return false;
}

function polyArea(p: Float32Array) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
  return Math.abs(a) / 2;
}

/**
 * OSM/Overture have footprints for the EGPH terminal complex but no heights (default 8 m).
 * Classify the buildings around the stands and give them plausible heights.
 * Heights are ESTIMATES (terminal ~3 storeys, piers ~2), not surveyed values.
 */
export function styleAirportBuildings(list: Building[], gates: [number, number][]): Building[] {
  if (!gates.length) return list;
  const gx = gates.reduce((a, g) => a + g[0], 0) / gates.length, gy = gates.reduce((a, g) => a + g[1], 0) / gates.length;
  for (const b of list) {
    const cE = (b.minE + b.maxE) / 2, cN = (b.minN + b.maxN) / 2;
    const d = Math.hypot(cE - gx, cN - gy);
    if (d > 450) continue;
    const area = polyArea(b.pts);
    const base = b.base + 1;
    if (area > 20000) { b.role = 'terminal'; b.top = base + 15; }
    else if (area > 5000 && d < 150) { b.role = 'pier'; b.top = base + 11; }
    else if (area > 1000 && gates.some(([x, y]) => pointInPoly(b.pts, x, y) || near(b, x, y))) { b.role = 'pier'; b.top = base + 10; }
    else if (area > 1200) { b.role = 'airside'; b.top = base + Math.max(b.top - base, 10); }
  }
  // Drop smaller OSM features that sit inside a terminal/pier footprint (overlapping duplicates,
  // old outlines) so they do not poke through the new building.
  const big = list.filter((b) => b.role === 'terminal' || b.role === 'pier');
  return list.filter((b) => {
    if (b.role) return true;
    const cE = (b.minE + b.maxE) / 2, cN = (b.minN + b.maxN) / 2;
    for (const t of big) {
      if (cE < t.minE || cE > t.maxE || cN < t.minN || cN > t.maxN) continue;
      let inside = 0;
      const n = b.pts.length / 2;
      for (let i = 0; i < n; i++) if (pointInPoly(t.pts, b.pts[2 * i], b.pts[2 * i + 1])) inside++;
      if (inside * 2 >= n || pointInPoly(t.pts, cE, cN)) return false;
    }
    return true;
  });
}

/** Boarding-bridge site: a gate point snapped to the nearest terminal/pier wall, with the airliner stand it serves. */
export interface GateSite {
  px: number; py: number; // pivot on the wall, local E/N metres
  nx: number; ny: number; // outward wall normal
  /** Airliner datum position [east, north] and true heading (deg) when parked nose-in with the front-left door at the stowed bridge. */
  stand: [number, number, number];
}

const SITE_REACH = 26; // m, pivot to door along the stowed bridge direction
const SITE_SWING = 0.49; // rad, must match the bridge rest swing
const DOOR_FWD = 12.8, DOOR_LEFT = 1.9; // 737-800 L1 door, body metres (estimate)

export function findGateSites(gates: [number, number][], buildings: Building[]): GateSite[] {
  const terms = buildings.filter((b) => b.role === 'terminal' || b.role === 'pier');
  const out: GateSite[] = [];
  const used: [number, number][] = [];
  for (const [gx, gy] of gates) {
    if (used.some(([x, y]) => Math.hypot(x - gx, y - gy) < 9)) continue;
    let best = { d: Infinity, px: 0, py: 0, nx: 0, ny: 0 };
    for (const b of terms) {
      const n = b.pts.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = b.pts[2 * i], ay = b.pts[2 * i + 1], bx = b.pts[2 * j], by = b.pts[2 * j + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        if (l2 < 1) continue;
        const t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / l2));
        const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(gx - px, gy - py);
        if (d < best.d) {
          const L = Math.sqrt(l2);
          let nx = dy / L, ny = -dx / L;
          if (pointInPoly(b.pts, px + nx * 0.5, py + ny * 0.5)) { nx = -nx; ny = -ny; }
          best = { d, px, py, nx, ny };
        }
      }
    }
    if (best.d > 40) continue;
    used.push([gx, gy]);
    const a = Math.atan2(best.ny, best.nx) + SITE_SWING;
    const Dx = best.px + Math.cos(a) * SITE_REACH, Dy = best.py + Math.sin(a) * SITE_REACH;
    const lx = best.ny, ly = -best.nx; // left of the heading (-normal)
    const x = Dx + best.nx * DOOR_FWD - lx * DOOR_LEFT, y = Dy + best.ny * DOOR_FWD - ly * DOOR_LEFT;
    let hdg = (Math.atan2(-best.nx, -best.ny) * 180) / Math.PI;
    hdg = (hdg + 360) % 360;
    out.push({ px: best.px, py: best.py, nx: best.nx, ny: best.ny, stand: [x, y, hdg] });
  }
  return out;
}

/** Airliner stands spaced for a 737 wingspan, from the gate sites. */
export function spacedStands(sites: GateSite[], minSep = 42): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const s of sites) if (out.every((o) => Math.hypot(o[0] - s.stand[0], o[1] - s.stand[1]) >= minSep)) out.push(s.stand);
  return out;
}
