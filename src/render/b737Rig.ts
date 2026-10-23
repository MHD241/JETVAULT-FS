// Animation rig for the supplied 737-800 mesh (model space: x span with the aircraft's right at -x, y up,
// z towards the nose, ~39.2 units per metre).
//
// The mesh has no skeleton and its control surfaces are only partly separate, so the rig:
//   - uses separate meshes where they exist (flap panels, slats, elevators, landing gear),
//   - cuts the aileron and rudder regions out of the wing skin / fin and replaces them with closed wedge
//     bodies lofted through the local cross-sections, so the surface itself moves (spoilers are plates on the skin),
//   - computes each hinge line from the part's own geometry (principal axis of its vertices in plan).
// Deflections come straight from the flight model's actual surface positions (after actuator lag), flap
// extension includes Fowler travel, slats extend with the flaps, flight spoilers help the ailerons, and the
// gear folds (nose forward, mains inboard) with nose-wheel steering. Part names are those of the supplied FBX.

import * as THREE from 'three';
import { Aircraft } from '../sim/fdm/aircraft';

const DEG = Math.PI / 180;
const UNITS_PER_M = 1404.4 / 35.79;

interface Surface {
  g: THREE.Group;
  pivot: THREE.Vector3;
  u: THREE.Vector3; // hinge axis
  v: THREE.Vector3; // forward (towards the leading edge), unit, horizontal for wing parts
  tedown: number; // +1 if rotating by +angle about u moves the trailing edge down (or towards +x for the rudder)
}

function worldVerts(m: THREE.Mesh): THREE.Vector3[] {
  m.updateWorldMatrix(true, false);
  const p = m.geometry.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  return out;
}

export class B737Rig {
  private root: THREE.Object3D;
  private meshes = new Map<string, THREE.Mesh>();
  private ail: Surface[] = []; // [right, left] (right = -x)
  private spoilIn: Surface[] = [];
  private spoilOut: Surface[] = [];
  private elev: Surface[] = [];
  private flapIn: Surface[] = [];
  private flapOut: Surface[] = [];
  private slats: Surface[] = [];
  private rudder: Surface | null = null;
  private noseGear: { g: THREE.Group; pivot: THREE.Vector3 } | null = null;
  private mainGear: { g: THREE.Group; pivot: THREE.Vector3; side: number }[] = [];
  readonly report: string[] = [];

  constructor(root: THREE.Object3D) {
    this.root = root;
    root.updateMatrixWorld(true);
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !this.meshes.has(m.name)) this.meshes.set(m.name, m); });
    const skin = this.meshes.get('Group_010');
    if (skin) this.wingSurfaces(skin);
    this.flapsAndSlats();
    this.elevators();
    this.finAndRudder();
    this.landingGear();
  }

  // ------------------------------------------------------------------ construction helpers

  /** Hinge from the part's vertices: axis = principal direction in plan, pivot on the forward (or aft) edge. */
  private hinge(verts: THREE.Vector3[], forwardEdge: boolean): { pivot: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } {
    const c = new THREE.Vector3();
    verts.forEach((p) => c.add(p)); c.multiplyScalar(1 / verts.length);
    let sxx = 0, sxz = 0, szz = 0;
    for (const p of verts) { const dx = p.x - c.x, dz = p.z - c.z; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const u = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    if (u.x < 0) u.multiplyScalar(-1);
    let v = new THREE.Vector3(-u.z, 0, u.x);
    if (v.z < 0) v.multiplyScalar(-1);
    let best = forwardEdge ? -Infinity : Infinity;
    for (const p of verts) { const t = (p.x - c.x) * v.x + (p.z - c.z) * v.z; best = forwardEdge ? Math.max(best, t) : Math.min(best, t); }
    return { pivot: c.clone().addScaledVector(v, best), u, v };
  }

  private makeSurface(meshes: THREE.Mesh[], forwardEdge: boolean): Surface | null {
    const verts = meshes.flatMap(worldVerts);
    if (verts.length < 3) return null;
    const h = this.hinge(verts, forwardEdge);
    const g = new THREE.Group();
    g.position.copy(h.pivot);
    this.root.add(g);
    g.updateMatrixWorld(true);
    for (const m of meshes) g.attach(m);
    // does +angle about u drop a point aft of the hinge?
    const p = h.v.clone().multiplyScalar(-1);
    const dy = h.u.z * p.x - h.u.x * p.z; // y component of u x p
    return { g, pivot: h.pivot, u: h.u, v: h.v, tedown: dy > 0 ? -1 : 1 };
  }

  /** Moves the triangles of `src` that satisfy `pred` (world-space centroid) into a new mesh (the originals are removed from `src`). */
  private extract(src: THREE.Mesh, pred: (c: THREE.Vector3) => boolean): THREE.Mesh | null {
    src.updateWorldMatrix(true, false);
    const g = src.geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const index = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
    const mats = Array.isArray(src.material) ? src.material : [src.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
    const P: number[] = [], N: number[] = [], U: number[] = [];
    const ng: { start: number; count: number; materialIndex: number }[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(src.matrixWorld);
    for (const gr of groups) {
      const start = P.length / 3;
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        a.fromBufferAttribute(pos, index[i]).applyMatrix4(src.matrixWorld);
        b.fromBufferAttribute(pos, index[i + 1]).applyMatrix4(src.matrixWorld);
        c.fromBufferAttribute(pos, index[i + 2]).applyMatrix4(src.matrixWorld);
        if (!pred(a.clone().add(b).add(c).multiplyScalar(1 / 3))) continue;
        for (let k = 0; k < 3; k++) {
          const vi = index[i + k];
          const w = new THREE.Vector3().fromBufferAttribute(pos, vi).applyMatrix4(src.matrixWorld);
          P.push(w.x, w.y, w.z);
          if (nor) { const nv = new THREE.Vector3().fromBufferAttribute(nor, vi).applyMatrix3(nm).normalize(); N.push(nv.x, nv.y, nv.z); }
          if (uv) U.push(uv.getX(vi), uv.getY(vi));
        }
      }
      if (P.length / 3 > start) ng.push({ start, count: P.length / 3 - start, materialIndex: gr.materialIndex ?? 0 });
    }
    if (!P.length) return null;
    this.removeTriangles(src, pred);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (nor) geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); else geo.computeVertexNormals();
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    ng.forEach((x) => geo.addGroup(x.start, x.count, x.materialIndex));
    const mesh = new THREE.Mesh(geo, Array.isArray(src.material) ? mats : mats[0]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  /** Removes the triangles of `mesh` whose world-space centroid satisfies `pred` (the geometry is edited in place). */
  private removeTriangles(mesh: THREE.Mesh, pred: (c: THREE.Vector3) => boolean) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const out: number[] = []; const ng: { start: number; count: number; materialIndex: number }[] = [];
    for (const gr of groups) {
      const start = out.length;
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        a.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, idx[i + 1]).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, idx[i + 2]).applyMatrix4(mesh.matrixWorld);
        if (!pred(a.add(b).add(c).multiplyScalar(1 / 3))) out.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      if (out.length > start) ng.push({ start, count: out.length - start, materialIndex: gr.materialIndex ?? 0 });
    }
    g.setIndex(out);
    g.clearGroups();
    if (g.groups.length === 0 && ng.length) ng.forEach((x) => g.addGroup(x.start, x.count, x.materialIndex));
  }

  /** Closed wedge (top, bottom, hinge wall, end caps) lofted through cross-sections A (top hinge), B (bottom hinge), C (trailing edge). */
  private wedge(sec: { A: THREE.Vector3; B: THREE.Vector3; C: THREE.Vector3 }[], material: THREE.Material): THREE.Mesh {
    const P: number[] = [];
    const cen = new THREE.Vector3();
    sec.forEach((q) => cen.add(q.A).add(q.B).add(q.C));
    cen.multiplyScalar(1 / (sec.length * 3));
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      const m = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(cen);
      if (n.dot(m) < 0) { P.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z); } else P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => { tri(a, b, c); tri(a, c, d); };
    for (let i = 0; i + 1 < sec.length; i++) {
      const s0 = sec[i], s1 = sec[i + 1];
      quad(s0.A, s1.A, s1.C, s0.C); // top
      quad(s0.B, s0.C, s1.C, s1.B); // bottom
      quad(s0.A, s0.B, s1.B, s1.A); // hinge wall
    }
    const f = sec[0], l = sec[sec.length - 1];
    tri(f.A, f.B, f.C); tri(l.A, l.B, l.C);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  /** Vertical extent of a mesh at a plan position (model space), by ray casting. */
  private heights(mesh: THREE.Mesh, x: number, z: number): { top: number; bottom: number } | null {
    const rc = new THREE.Raycaster();
    rc.set(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0));
    const down = rc.intersectObject(mesh, false);
    if (!down.length) return null;
    rc.set(new THREE.Vector3(x, -2000, z), new THREE.Vector3(0, 1, 0));
    const up = rc.intersectObject(mesh, false);
    return { top: down[0].point.y, bottom: up.length ? up[0].point.y : down[down.length - 1].point.y };
  }

  private mirror(name: string): THREE.Mesh | null {
    const m = this.meshes.get(name);
    if (!m) return null;
    const b = new THREE.Box3().setFromObject(m);
    let best: THREE.Mesh | null = null, bestD = Infinity;
    const tri = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    for (const o of this.meshes.values()) {
      if (o === m) continue;
      const ob = new THREE.Box3().setFromObject(o);
      const t2 = (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
      if (Math.abs(t2 - tri) > Math.max(2, tri * 0.08)) continue;
      const d = Math.abs(ob.min.x + b.max.x) + Math.abs(ob.max.x + b.min.x) + Math.abs(ob.min.z - b.min.z) + Math.abs(ob.max.z - b.max.z) + Math.abs(ob.min.y - b.min.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    return bestD < 12 ? best : null;
  }

  // ------------------------------------------------------------------ parts

  private wingSurfaces(skin: THREE.Mesh) {
    const verts = worldVerts(skin);
    const bins = new Map<number, { zmin: number; zmax: number }>();
    for (const p of verts) {
      const k = Math.round(Math.abs(p.x) / 20);
      const e = bins.get(k) ?? { zmin: Infinity, zmax: -Infinity };
      e.zmin = Math.min(e.zmin, p.z); e.zmax = Math.max(e.zmax, p.z); bins.set(k, e);
    }
    const te = (x: number) => bins.get(Math.round(Math.abs(x) / 20))?.zmin ?? 0;
    const ch = (x: number) => { const e = bins.get(Math.round(Math.abs(x) / 20)); return e ? e.zmax - e.zmin : 100; };
    const skinMat = (Array.isArray(skin.material) ? skin.material[0] : skin.material).clone();
    skinMat.side = THREE.DoubleSide;
    const A0 = 548, A1 = 646; // aileron span (model units from the centreline)
    for (const side of [1, -1]) { // +x = the aircraft's left, -x = right
      const sx = (x: number) => Math.abs(x);
      // ---- aileron: a closed wedge replaces the skin aft of the hinge line (so the surface itself moves)
      const stations: { A: THREE.Vector3; B: THREE.Vector3; C: THREE.Vector3 }[] = [];
      for (let i = 0; i <= 6; i++) {
        const x = side * (A0 + (A1 - A0) * (i / 6));
        const zh = te(x) + 0.26 * ch(x);
        const hh = this.heights(skin, x, zh), ht = this.heights(skin, x, te(x) + 3);
        if (!hh || !ht) continue;
        const yc = (ht.top + ht.bottom) / 2;
        stations.push({ A: new THREE.Vector3(x, hh.top, zh), B: new THREE.Vector3(x, hh.bottom, zh), C: new THREE.Vector3(x, yc, te(x)) });
      }
      if (stations.length >= 3) {
        this.removeTriangles(skin, (c) => Math.sign(c.x) === side && sx(c.x) >= A0 && sx(c.x) <= A1 && c.z < te(c.x) + 0.26 * ch(c.x));
        const wm = this.wedge(stations, skinMat);
        const sf = this.makeSurface([wm], true);
        if (sf) this.ail[side > 0 ? 1 : 0] = sf;
      }
      // ---- spoilers: thin plates on the upper skin, hinged at their forward edge
      for (const [x0, x1, set] of [[215, 372, this.spoilIn], [380, 540, this.spoilOut]] as const) {
        const A: THREE.Vector3[] = [], B: THREE.Vector3[] = [], C: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const x = side * (x0 + (x1 - x0) * (i / 4));
          const zf = te(x) + 0.53 * ch(x), zb = te(x) + 0.33 * ch(x);
          const hf = this.heights(skin, x, zf), hb = this.heights(skin, x, zb);
          if (!hf || !hb) continue;
          A.push(new THREE.Vector3(x, hf.top + 0.5, zf)); B.push(new THREE.Vector3(x, hf.top - 0.6, zf)); C.push(new THREE.Vector3(x, hb.top + 0.5, zb));
        }
        if (A.length < 3) continue;
        // plate: top face from forward edge A to aft edge C; bottom face 1.1 units below
        const sec = A.map((a, i) => ({ A: a, B: B[i], C: C[i].clone().setY(C[i].y - 0.6) }));
        const pm = this.wedge(sec, skinMat);
        const sf = this.makeSurface([pm], true);
        if (sf) set[side > 0 ? 1 : 0] = sf;
      }
    }
    this.report.push(`aileron ${this.ail.filter(Boolean).length}/2, spoilers ${this.spoilIn.filter(Boolean).length + this.spoilOut.filter(Boolean).length}/4`);
  }

  private flapsAndSlats() {
    const group = (names: string[]) => names.flatMap((n) => [this.meshes.get(n), this.mirror(n)]).filter(Boolean) as THREE.Mesh[];
    const split = (names: string[]) => {
      const right = names.map((n) => this.meshes.get(n)).filter(Boolean) as THREE.Mesh[];
      const left = names.map((n) => this.mirror(n)).filter(Boolean) as THREE.Mesh[];
      return [right, left];
    };
    void group;
    const [inR, inL] = split(['Group_045', 'Group_046', 'Group_068', 'Group_069']);
    const [outR, outL] = split(['Group_070', 'Group_043']);
    for (const set of [inR, inL]) { const s = set.length && this.makeSurface(set, true); if (s) this.flapIn.push(s); }
    for (const set of [outR, outL]) { const s = set.length && this.makeSurface(set, true); if (s) this.flapOut.push(s); }
    for (const n of ['Group_044', 'Group_047', 'Group_048', 'Group_049', 'Group_050', 'Group_055']) {
      for (const m of [this.meshes.get(n), this.mirror(n)]) { if (!m) continue; const s = this.makeSurface([m], false); if (s) this.slats.push(s); }
    }
    this.report.push(`flaps ${this.flapIn.length + this.flapOut.length}/4, slats ${this.slats.length}/12`);
  }

  private elevators() {
    for (const n of ['Group_006', 'Group_004']) {
      const m = this.meshes.get(n);
      const s = m && this.makeSurface([m], true);
      if (s) this.elev.push(s);
    }
    this.report.push(`elevators ${this.elev.length}/2`);
  }

  private finAndRudder() {
    const fin = this.meshes.get('Group_082');
    if (!fin) return;
    const verts = worldVerts(fin);
    const yBase = Math.min(...verts.map((p) => p.y)), yTop = Math.max(...verts.map((p) => p.y));
    // trailing / leading edge of the fin at height y, from the vertices in a thin band around it
    const edge = (y: number) => {
      const band = verts.filter((p) => Math.abs(p.y - y) < 7);
      if (!band.length) return { zmin: -700, zmax: -400 };
      return { zmin: Math.min(...band.map((p) => p.z)), zmax: Math.max(...band.map((p) => p.z)) };
    };
    const mat = (Array.isArray(fin.material) ? fin.material[0] : fin.material).clone();
    mat.side = THREE.DoubleSide;
    const ymin = yBase + 40, ymax = yTop - 4;
    const N = 12;
    // The fin's edges are straight, so fit straight lines (least squares) to the measured trailing edge and
    // thickness; the hinge line sits a fixed fraction of the local chord forward of the trailing edge.
    const fit = (f: (y: number) => number) => {
      let n = 0, sy = 0, sv = 0, syy = 0, syv = 0;
      for (let i = 0; i <= N; i++) { const y = ymin + (ymax - ymin) * (i / N), v = f(y); n++; sy += y; sv += v; syy += y * y; syv += y * v; }
      const k = (n * syv - sy * sv) / (n * syy - sy * sy), c0 = (sv - k * sy) / n;
      return (y: number) => c0 + k * y;
    };
    const teFit = fit((y) => edge(y).zmin);
    const leFit = fit((y) => edge(y).zmax);
    const hingeFit = (y: number) => teFit(y) + 0.30 * (leFit(y) - teFit(y));
    const halfW = fit((y) => {
      const z = hingeFit(y);
      const near = verts.filter((p) => Math.abs(p.y - y) < 9 && Math.abs(p.z - z) < 12);
      return near.length ? Math.max(1.5, Math.max(...near.map((p) => Math.abs(p.x)))) : 3;
    });
    const zhS: number[] = [], zteS: number[] = [];
    const sec: { A: THREE.Vector3; B: THREE.Vector3; C: THREE.Vector3 }[] = [];
    for (let i = 0; i <= N; i++) {
      const y = ymin + (ymax - ymin) * (i / N), z = hingeFit(y), w = Math.max(1.2, halfW(y));
      zhS.push(z); zteS.push(teFit(y));
      sec.push({ A: new THREE.Vector3(-w, y, z), B: new THREE.Vector3(w, y, z), C: new THREE.Vector3(0, y, teFit(y)) });
    }
    const at = (arr: number[], y: number) => { const t = THREE.MathUtils.clamp((y - ymin) / (ymax - ymin), 0, 1) * N; const i = Math.min(N - 1, Math.floor(t)); return arr[i] + (arr[i + 1] - arr[i]) * (t - i); };
    this.removeTriangles(fin, (c) => c.y >= ymin && c.y <= ymax && c.z < at(zhS, c.y));
    const mesh = this.wedge(sec, mat);
    const p0 = new THREE.Vector3(0, ymin, zhS[0]), p1 = new THREE.Vector3(0, ymax, zhS[N]);
    const u = p1.clone().sub(p0).normalize();
    const g = new THREE.Group(); g.position.copy(p0); this.root.add(g); g.updateMatrixWorld(true); g.attach(mesh);
    const pv = new THREE.Vector3(0, 0, -1);
    const dx = u.y * pv.z - u.z * pv.y; // x component of u x p
    this.rudder = { g, pivot: p0, u, v: new THREE.Vector3(0, 0, 1), tedown: dx > 0 ? 1 : -1 };
    this.report.push('rudder 1/1');
  }

  private landingGear() {
    // Named parts of the supplied mesh: nose strut+wheels is one mesh; each main gear is a leg (with drag brace),
    // a wheel/axle assembly and two small axle parts. The inboard doors and belly fairings stay fixed.
    const nose = this.meshes.get('Group_102');
    if (nose) {
      const bb = new THREE.Box3().setFromObject(nose);
      const pivot = new THREE.Vector3(0, bb.max.y, (bb.min.z + bb.max.z) / 2);
      const g = new THREE.Group(); g.position.copy(pivot); this.root.add(g); g.updateMatrixWorld(true); g.attach(nose);
      this.noseGear = { g, pivot };
    }
    // the tyres of both main gears are one mesh (Group_001): split it into a left and a right half
    const tyres = this.meshes.get('Group_001');
    const tyreSides = new Map<number, THREE.Mesh>();
    if (tyres) {
      const right = this.extract(tyres, (c) => c.x > 0), left = this.extract(tyres, (c) => c.x < 0);
      if (right) tyreSides.set(1, right);
      if (left) tyreSides.set(-1, left);
    }
    for (const [side, names] of [[-1, ['Component#5_001', 'Group_098', 'Group_100']], [1, ['Component#5_002', 'Group_093', 'Group_101']]] as const) {
      const set = names.map((n) => this.meshes.get(n)).filter(Boolean) as THREE.Mesh[];
      if (tyreSides.get(side)) set.push(tyreSides.get(side)!);
      if (!set.length) continue;
      const leg = new THREE.Box3().setFromObject(set[0]); // strut + brace: its top is the attachment to the wing
      const pivot = new THREE.Vector3((leg.min.x + leg.max.x) / 2, leg.max.y, (leg.min.z + leg.max.z) / 2);
      const g = new THREE.Group(); g.position.copy(pivot); this.root.add(g); g.updateMatrixWorld(true);
      set.forEach((m) => g.attach(m));
      this.mainGear.push({ g, pivot, side });
    }
    this.report.push(`gear nose ${nose ? 1 : 0}, mains ${this.mainGear.length}`);
  }

  // ------------------------------------------------------------------ animation

  private static rot(s: Surface | null | undefined, ang: number, shift?: THREE.Vector3) {
    if (!s) return;
    s.g.quaternion.setFromAxisAngle(s.u, ang * s.tedown);
    s.g.position.copy(s.pivot);
    if (shift) s.g.position.add(shift);
  }

  update(ac: Aircraft) {
    // ailerons: ac.aileronL / aileronR positive = trailing edge down
    B737Rig.rot(this.ail[0], ac.aileronR); B737Rig.rot(this.ail[1], ac.aileronL);
    // elevators
    for (const e of this.elev) B737Rig.rot(e, ac.elevator);
    // rudder: + = trailing edge to the aircraft's left
    B737Rig.rot(this.rudder, ac.rudder);
    // spoilers: ground/flight spoilers rise with the speedbrake; flight spoilers (outer) also help the up-going aileron
    const sb = ac.spoiler;
    const roll = (ail: number) => THREE.MathUtils.clamp(-ail / (20 * DEG), 0, 1);
    // ground spoilers (inboard) rise only on the ground; flight spoilers (outboard) follow the speedbrake and the roll command
    const gnd = ac.onGround ? sb * 60 * DEG : 0;
    const flt = (ail: number) => Math.min(50 * DEG, sb * 40 * DEG + roll(ail) * 30 * DEG);
    B737Rig.rot(this.spoilIn[0], -gnd); B737Rig.rot(this.spoilIn[1], -gnd);
    B737Rig.rot(this.spoilOut[0], -flt(ac.aileronR)); B737Rig.rot(this.spoilOut[1], -flt(ac.aileronL));
    // flaps: rotation plus Fowler travel aft and down
    const f = ac.flap, fr = f / (40 * DEG);
    const aft = (s: Surface | undefined, k: number) => s && new THREE.Vector3().addScaledVector(s.v, -fr * k * UNITS_PER_M * 0.42).add(new THREE.Vector3(0, -fr * 0.12 * UNITS_PER_M * k, 0));
    this.flapIn.forEach((s) => B737Rig.rot(s, f, aft(s, 1)));
    this.flapOut.forEach((s) => B737Rig.rot(s, f, aft(s, 0.8)));
    // slats: intermediate for flaps 1-5, full extension beyond
    const ext = f > 7 * DEG ? 1 : f > 0.4 * DEG ? 0.6 : 0;
    for (const s of this.slats) {
      s.g.position.copy(s.pivot).addScaledVector(s.v, 0.18 * UNITS_PER_M * ext).add(new THREE.Vector3(0, -0.09 * UNITS_PER_M * ext, 0));
      s.g.quaternion.setFromAxisAngle(s.u, -s.tedown * ext * 12 * DEG);
    }
    // landing gear: smooth fold, nose forward, mains inboard; nose wheel steering when down
    const ret = 1 - THREE.MathUtils.smoothstep(ac.gearExt, 0.05, 0.95);
    if (this.noseGear) {
      const g = this.noseGear.g;
      const steer = ac.gearStates[0]?.steer ?? 0;
      g.quaternion.setFromEuler(new THREE.Euler(-ret * 90 * DEG, -steer, 0, 'YXZ'));
      g.visible = ac.gearExt > 0.01;
    }
    for (const m of this.mainGear) {
      m.g.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -m.side * ret * 88 * DEG);
      m.g.visible = ac.gearExt > 0.01;
    }
  }
}
