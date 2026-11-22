// Road markings: dashed centre lines and solid edge lines on the roads near the camera. The road network is painted into a coarse texture (4 m per pixel), far too
// coarse for a 12 cm line, so the markings are real geometry: thin strips built from the road polylines within ~450 m of the camera, rebuilt as the camera moves,
// and hidden when you are high up (they would be sub-pixel). Also applies to the motorway lane lines.
import * as THREE from 'three';

export type RoadSeg = [string, [number, number][]];
export interface LineSpec { offset: number; dashed: boolean; width: number }

/** Dash pattern (m): a UK centre line is a short line and a long gap; motorway lane lines are 4 m lines with 12 m gaps. */
export const DASH = { centre: [3, 7], lane: [4, 12] } as const;

/** The markings of a road class: lines at `offset` metres from the centre line (positive = left). Classes without markings return []. */
export function lineSpecs(cls: string): (LineSpec & { dash?: readonly number[] })[] {
  switch (cls) {
    case 'motorway': return [{ offset: 5.2, dashed: false, width: 0.2 }, { offset: -5.2, dashed: false, width: 0.2 }, { offset: 1.8, dashed: true, width: 0.14, dash: DASH.lane }, { offset: -1.8, dashed: true, width: 0.14, dash: DASH.lane }];
    case 'trunk': case 'primary': return [{ offset: 3.5, dashed: false, width: 0.15 }, { offset: -3.5, dashed: false, width: 0.15 }, { offset: 0, dashed: true, width: 0.13, dash: DASH.centre }];
    case 'secondary': case 'tertiary': return [{ offset: 0, dashed: true, width: 0.12, dash: DASH.centre }];
    default: return [];
  }
}

/** Appends the strips of one road to `pos` (x, y, z triples) and `idx`. Pure geometry: `heightAt(east, north)` gives the ground. */
export function buildRoadMarkings(pts: [number, number][], cls: string, heightAt: (e: number, n: number) => number, pos: number[], idx: number[], lift = 0.12) {
  const specs = lineSpecs(cls); if (!specs.length || pts.length < 2) return;
  // unit normals per point (average of the neighbouring segments)
  const n = pts.length, nx = new Array<number>(n), ny = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    nx[i] = -ty; ny[i] = tx;
  }
  // arc length along the centre line
  const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const quad = (x0: number, y0: number, x1: number, y1: number, hw: number) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy); if (l < 1e-6) return;
    const px = (-dy / l) * hw, py = (dx / l) * hw, b = pos.length / 3;
    for (const [x, y] of [[x0 + px, y0 + py], [x0 - px, y0 - py], [x1 + px, y1 + py], [x1 - px, y1 - py]]) pos.push(x, heightAt(x, y) + lift, -y);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  for (const sp of specs) {
    const off = (i: number): [number, number] => [pts[i][0] + nx[i] * sp.offset, pts[i][1] + ny[i] * sp.offset];
    if (!sp.dashed) { for (let i = 0; i + 1 < n; i++) { const a = off(i), b = off(i + 1); quad(a[0], a[1], b[0], b[1], sp.width / 2); } continue; }
    const [dash, gap] = sp.dash ?? DASH.centre, period = dash + gap;
    for (let i = 0; i + 1 < n; i++) {
      const a = off(i), b = off(i + 1), L = s[i + 1] - s[i]; if (L < 1e-6) continue;
      // the dashes that overlap this segment: arc length windows [k*period, k*period + dash]
      for (let k = Math.floor(s[i] / period); k * period < s[i + 1]; k++) {
        const t0 = Math.max(s[i], k * period), t1 = Math.min(s[i + 1], k * period + dash); if (t1 - t0 < 0.3) continue;
        const u0 = (t0 - s[i]) / L, u1 = (t1 - s[i]) / L;
        quad(a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0, a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1, sp.width / 2);
      }
    }
  }
}

/** The widths the road texture is drawn with (airportMesh.buildRoadOverlay), so the test matches what is seen. */
export const DRAWN_WIDTH: Record<string, number> = { motorway: 32, trunk: 24, primary: 17, secondary: 13, tertiary: 10.5, residential: 8.5, unclassified: 7.5, living_street: 6.5, service: 5.5 };
const CELL = 400, RADIUS = 450, REBUILD = 120, MAX_VERTS = 400000, HIDE_AGL = 500;

export class RoadMarkings {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private patches = new Map<string, { roads: RoadSeg[]; cells: Map<number, number[]>; all: Map<number, number[]> }>();
  private lastX = 1e9; private lastZ = 1e9; private dirty = true;
  private mat = new THREE.MeshStandardMaterial({ color: 0xe9e7dc, roughness: 0.85, metalness: 0, emissive: 0xffd9a0, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  constructor(private heightAt: (e: number, n: number) => number) { this.group.name = 'road markings'; this.group.visible = false; }

  addPatch(id: string, roads: RoadSeg[]) {
    const cells = new Map<number, number[]>(), all = new Map<number, number[]>(); const key = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096);
    roads.forEach(([cls, pts], i) => {
      let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const marked = lineSpecs(cls).length > 0;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = key(cx, cy); let l = all.get(k); if (!l) { l = []; all.set(k, l); } l.push(i);
        if (marked) { let m = cells.get(k); if (!m) { m = []; cells.set(k, m); } m.push(i); }
      }
    });
    this.patches.set(id, { roads, cells, all }); this.dirty = true;
  }
  /** A random road near (e, n) within `radius` m (not a very short one): its class, points and a unique key; null if there is none. */
  randomRoad(e: number, n: number, radius: number, rnd: () => number): { cls: string; pts: [number, number][]; key: string } | null {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius, qe = e + Math.cos(a) * d, qn = n + Math.sin(a) * d;
    const k = (Math.floor(qe / CELL) + 4096) * 8192 + (Math.floor(qn / CELL) + 4096);
    for (const [id, p] of this.patches) {
      const l = p.all.get(k); if (!l || !l.length) continue;
      for (let tries = 0; tries < 6; tries++) {
        const i = l[Math.floor(rnd() * l.length)], [cls, pts] = p.roads[i];
        if (pts.length < 2 || (cls === 'service' && rnd() < 0.5)) continue;
        return { cls, pts, key: `${id}:${i}` };
      }
    }
    return null;
  }
  /** True where a road surface is (within `margin` m of a road's drawn width): grass and trees must not grow there. */
  onRoad(e: number, n: number, margin = 1): boolean {
    const k = (Math.floor(e / CELL) + 4096) * 8192 + (Math.floor(n / CELL) + 4096);
    for (const p of this.patches.values()) {
      const l = p.all.get(k); if (!l) continue;
      for (const i of l) {
        const [cls, pts] = p.roads[i], hw = (DRAWN_WIDTH[cls] ?? 6) / 2 + margin;
        for (let q = 0; q + 1 < pts.length; q++) {
          const ax = pts[q][0], ay = pts[q][1], dx = pts[q + 1][0] - ax, dy = pts[q + 1][1] - ay, L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / L2)) : 0, ex = ax + dx * t - e, ey = ay + dy * t - n;
          if (ex * ex + ey * ey < hw * hw) return true;
        }
      }
    }
    return false;
  }
  removePatch(id: string) { this.patches.delete(id); this.dirty = true; }
  dispose() { this.mesh?.geometry.dispose(); this.mat.dispose(); }

  /** Call every frame with the camera position (three.js world), the height above ground and the night factor (0..1). */
  update(cam: THREE.Vector3, agl: number, night: number) {
    this.mat.emissiveIntensity = 0.28 * night;   // painted lines under street lamps still read at night
    const show = agl < HIDE_AGL && this.patches.size > 0; this.group.visible = show; if (!show) return;
    const e = cam.x, n = -cam.z;
    if (!this.dirty && Math.hypot(e - this.lastX, n - this.lastZ) < REBUILD) return;
    this.dirty = false; this.lastX = e; this.lastZ = n;
    const pos: number[] = [], idx: number[] = [], key = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096);
    for (const p of this.patches.values()) {
      const seen = new Set<number>();
      for (let cx = Math.floor((e - RADIUS) / CELL); cx <= Math.floor((e + RADIUS) / CELL); cx++) for (let cy = Math.floor((n - RADIUS) / CELL); cy <= Math.floor((n + RADIUS) / CELL); cy++) {
        for (const i of p.cells.get(key(cx, cy)) ?? []) { if (seen.has(i) || pos.length / 3 > MAX_VERTS) continue; seen.add(i); const [cls, pts] = p.roads[i]; buildRoadMarkings(pts, cls, this.heightAt, pos, idx); }
      }
    }
    this.mesh?.geometry.dispose();
    if (!pos.length) { if (this.mesh) this.group.remove(this.mesh); this.mesh = null; return; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeVertexNormals();
    if (!this.mesh) { this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.group.add(this.mesh); } else this.mesh.geometry = g;
  }
}
