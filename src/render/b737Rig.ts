// Animation rig for the supplied 737-800 mesh (model space: x span with the aircraft's right at -x, y up,
// z towards the nose, ~39.2 units per metre).
//
// The mesh has no skeleton and its control surfaces are only partly separate, so the rig:
//   - uses separate meshes where they exist (flap panels, slats, elevators, landing gear),
//   - carves duplicate triangles out of the wing skin (ailerons, spoilers) and the fin (rudder); the
//     original skin stays underneath so no hole opens when a carved surface moves,
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

  /** Duplicates the triangles of `src` that satisfy `pred` (world-space centroid and normal) into a new mesh. */
  private carve(src: THREE.Mesh, pred: (c: THREE.Vector3, n: THREE.Vector3) => boolean): THREE.Mesh | null {
    src.updateWorldMatrix(true, false);
    const g = src.geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const index = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
    const mats = Array.isArray(src.material) ? src.material : [src.material];
    const groupOf = (tri: number) => {
      if (!g.groups.length || mats.length === 1) return 0;
      for (const gr of g.groups) if (tri * 3 >= gr.start && tri * 3 < gr.start + gr.count) return gr.materialIndex ?? 0;
      return 0;
    };
    const per: number[][] = mats.map(() => []);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < index.length / 3; t++) {
      a.fromBufferAttribute(pos, index[3 * t]).applyMatrix4(src.matrixWorld);
      b.fromBufferAttribute(pos, index[3 * t + 1]).applyMatrix4(src.matrixWorld);
      c.fromBufferAttribute(pos, index[3 * t + 2]).applyMatrix4(src.matrixWorld);
      cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
      if (pred(cen, n)) per[groupOf(t)].push(3 * t);
    }
    const P: number[] = [], N: number[] = [], U: number[] = [];
    const groups: { start: number; count: number; materialIndex: number }[] = [];
    const nm = new THREE.Matrix3().getNormalMatrix(src.matrixWorld);
    per.forEach((starts, mi) => {
      const start = P.length / 3;
      for (const s of starts) for (let k = 0; k < 3; k++) {
        const vi = index[s + k];
        const w = new THREE.Vector3().fromBufferAttribute(pos, vi).applyMatrix4(src.matrixWorld);
        P.push(w.x, w.y, w.z);
        if (nor) { const nv = new THREE.Vector3().fromBufferAttribute(nor, vi).applyMatrix3(nm).normalize(); N.push(nv.x, nv.y, nv.z); }
        if (uv) U.push(uv.getX(vi), uv.getY(vi));
      }
      if (P.length / 3 > start) groups.push({ start, count: P.length / 3 - start, materialIndex: mi });
    });
    if (!P.length) return null;
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (nor) ng.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); else ng.computeVertexNormals();
    if (uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    groups.forEach((gr) => ng.addGroup(gr.start, gr.count, gr.materialIndex));
    const dup = mats.map((m) => { const q = m.clone(); q.polygonOffset = true; q.polygonOffsetFactor = -1; q.polygonOffsetUnits = -2; return q; });
    const mesh = new THREE.Mesh(ng, Array.isArray(src.material) ? dup : dup[0]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
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
    for (const side of [1, -1]) { // +x = the aircraft's left, -x = right
      const sx = (x: number) => Math.abs(x);
      const ailMesh = this.carve(skin, (c) => Math.sign(c.x) === side && sx(c.x) > 560 && sx(c.x) < 648 && c.z < te(c.x) + 0.27 * ch(c.x));
      const inMesh = this.carve(skin, (c, n) => Math.sign(c.x) === side && sx(c.x) > 215 && sx(c.x) < 372 && n.y > 0.3 && c.z > te(c.x) + 0.30 * ch(c.x) && c.z < te(c.x) + 0.50 * ch(c.x));
      const outMesh = this.carve(skin, (c, n) => Math.sign(c.x) === side && sx(c.x) > 378 && sx(c.x) < 545 && n.y > 0.3 && c.z > te(c.x) + 0.30 * ch(c.x) && c.z < te(c.x) + 0.50 * ch(c.x));
      const a = ailMesh && this.makeSurface([ailMesh], true), i = inMesh && this.makeSurface([inMesh], true), o = outMesh && this.makeSurface([outMesh], true);
      if (a) this.ail[side > 0 ? 1 : 0] = a;
      if (i) this.spoilIn[side > 0 ? 1 : 0] = i;
      if (o) this.spoilOut[side > 0 ? 1 : 0] = o;
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
    const bandOf = (y: number) => Math.round(y / 25);
    const bins = new Map<number, { zmin: number; zmax: number }>();
    for (const p of verts) { const k = bandOf(p.y); const e = bins.get(k) ?? { zmin: Infinity, zmax: -Infinity }; e.zmin = Math.min(e.zmin, p.z); e.zmax = Math.max(e.zmax, p.z); bins.set(k, e); }
    const e = (y: number) => bins.get(bandOf(y)) ?? { zmin: -700, zmax: -400 };
    const mesh = this.carve(fin, (c) => c.y > 235 && c.z < e(c.y).zmin + 0.30 * (e(c.y).zmax - e(c.y).zmin));
    if (!mesh) return;
    // hinge: vertical-ish line along the forward edge of the carved part (bottom and top points)
    const vv = worldVerts(mesh);
    let lo: THREE.Vector3 | null = null, hi: THREE.Vector3 | null = null;
    for (const p of vv) { if (!lo || p.y < lo.y) lo = p; if (!hi || p.y > hi.y) hi = p; }
    const fwdAt = (y: number) => Math.max(...vv.filter((p) => Math.abs(p.y - y) < 12).map((p) => p.z));
    const p0 = new THREE.Vector3(0, lo!.y, fwdAt(lo!.y + 12)), p1 = new THREE.Vector3(0, hi!.y, fwdAt(hi!.y - 12));
    const u = p1.clone().sub(p0).normalize();
    const g = new THREE.Group(); g.position.copy(p0); this.root.add(g); g.updateMatrixWorld(true); g.attach(mesh);
    const pv = new THREE.Vector3(0, 0, -1); // aft point
    const dx = u.y * pv.z - u.z * pv.y; // x component of u x p
    this.rudder = { g, pivot: p0, u, v: new THREE.Vector3(0, 0, 1), tedown: dx > 0 ? 1 : -1 };
    this.report.push('rudder 1/1');
  }

  private landingGear() {
    const low: THREE.Mesh[] = [];
    for (const m of this.meshes.values()) {
      const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3());
      if (Math.abs(c.x) <= 160 && c.y <= 110 && b.max.y <= 125 && (Math.abs(c.z) <= 40 || c.z > 550)) low.push(m);
    }
    const nose = low.filter((m) => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).z > 550);
    if (nose.length) {
      const bb = new THREE.Box3(); nose.forEach((m) => bb.expandByObject(m));
      const pivot = new THREE.Vector3(0, bb.max.y, (bb.min.z + bb.max.z) / 2);
      const g = new THREE.Group(); g.position.copy(pivot); this.root.add(g); g.updateMatrixWorld(true);
      nose.forEach((m) => g.attach(m));
      this.noseGear = { g, pivot };
    }
    for (const side of [1, -1]) {
      const set = low.filter((m) => !nose.includes(m) && Math.sign(new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).x) === side);
      if (!set.length) continue;
      const bb = new THREE.Box3(); set.forEach((m) => bb.expandByObject(m));
      const pivot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2);
      const g = new THREE.Group(); g.position.copy(pivot); this.root.add(g); g.updateMatrixWorld(true);
      set.forEach((m) => g.attach(m));
      this.mainGear.push({ g, pivot, side });
    }
    this.report.push(`gear nose ${nose.length} parts, mains ${this.mainGear.map((m) => m.g.children.length).join('+')}`);
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
