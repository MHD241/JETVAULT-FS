// Simple low-poly people: standing, walking and seated figures, instanced (two meshes: clothes and head), for the airport and the cabin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CLOTHES = [0x3a4a66, 0x6b2230, 0x2f5d4a, 0x8a7a55, 0x55306e, 0x222831, 0xb0562a, 0x4a6e8f, 0x7a7d84, 0x9a3b3b];
const SKIN = [0xf1c9a5, 0xd9a577, 0xb07a50, 0x7a4f33, 0x4a2f1f, 0xe8b894];

/** A standing figure about 1.7 m tall: legs, torso with arms, head is separate. Origin at the feet (y up). */
export function bodyGeometry(seated = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number) => { const g = new THREE.CylinderGeometry(rt, rb, h, 8).translate(x, y, z); return g.toNonIndexed(); };
  if (!seated) { parts.push(cyl(0.085, 0.075, 0.8, -0.09, 0.4, 0), cyl(0.085, 0.075, 0.8, 0.09, 0.4, 0)); }
  else { parts.push(new THREE.BoxGeometry(0.2, 0.12, 0.42).translate(-0.09, 0.0, 0.2).toNonIndexed(), new THREE.BoxGeometry(0.2, 0.12, 0.42).translate(0.09, 0.0, 0.2).toNonIndexed(), cyl(0.07, 0.06, 0.45, -0.09, -0.22, 0.42), cyl(0.07, 0.06, 0.45, 0.09, -0.22, 0.42)); }
  const ty = seated ? 0.32 : 1.08;
  parts.push(new THREE.CapsuleGeometry(0.19, 0.38, 3, 8).translate(0, ty, 0).toNonIndexed(), cyl(0.05, 0.05, 0.55, -0.26, ty - 0.02, 0), cyl(0.05, 0.05, 0.55, 0.26, ty - 0.02, 0));
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts.map((g) => { const n = g.clone(); n.deleteAttribute('uv'); return n; }))!;
}
export const headGeometry = (y: number) => new THREE.SphereGeometry(0.11, 10, 8).translate(0, y, 0);

export interface Person { x: number; z: number; y?: number; yaw: number; seated?: boolean; path?: [number, number][]; speed?: number; t?: number; cloth: number; skin: number }

/** A group of people drawn with two instanced meshes. */
export class PeopleField {
  readonly group = new THREE.Group();
  private standing: THREE.InstancedMesh; private seatedBody: THREE.InstancedMesh; private heads: THREE.InstancedMesh;
  private people: Person[];
  constructor(people: Person[]) {
    this.people = people; const n = Math.max(1, people.length), m = new THREE.MeshStandardMaterial({ roughness: 0.9 }), hm = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.standing = new THREE.InstancedMesh(bodyGeometry(false), m, n); this.seatedBody = new THREE.InstancedMesh(bodyGeometry(true), m, n); this.heads = new THREE.InstancedMesh(headGeometry(0), hm, n);
    people.forEach((p, i) => { const c = new THREE.Color(CLOTHES[p.cloth % CLOTHES.length]); this.standing.setColorAt(i, c); this.seatedBody.setColorAt(i, c); this.heads.setColorAt(i, new THREE.Color(SKIN[p.skin % SKIN.length])); });
    this.group.add(this.standing, this.seatedBody, this.heads); this.update(0);
  }
  /** Moves the walkers along their paths (back and forth) and places everybody. */
  update(dt: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0); let ns = 0, nb = 0;
    this.people.forEach((pe, i) => {
      if (pe.path && pe.path.length > 1 && pe.speed) {
        pe.t = (pe.t ?? 0) + dt * pe.speed; let L = 0; const segs = pe.path.slice(1).map((b, k) => { const a = pe.path![k], l = Math.hypot(b[0] - a[0], b[1] - a[1]); L += l; return l; });
        const u = pe.t % (2 * L), d = u < L ? u : 2 * L - u; let acc = 0, k = 0; while (k < segs.length - 1 && acc + segs[k] < d) { acc += segs[k]; k++; }
        const a = pe.path[k], b = pe.path[k + 1], f = segs[k] ? (d - acc) / segs[k] : 0; pe.x = a[0] + (b[0] - a[0]) * f; pe.z = a[1] + (b[1] - a[1]) * f;
        const dir = u < L ? 1 : -1; pe.yaw = Math.atan2(-(b[1] - a[1]) * dir, (b[0] - a[0]) * dir);
      }
      const bob = pe.path ? Math.abs(Math.sin((pe.t ?? 0) * 5.5)) * 0.03 : 0, y = (pe.y ?? 0) + bob;
      q.setFromAxisAngle(up, pe.yaw); p.set(pe.x, y, pe.z); m.compose(p, q, one);
      if (pe.seated) { this.seatedBody.setMatrixAt(nb, m); } else { this.standing.setMatrixAt(ns, m); }
      const h = new THREE.Matrix4().compose(new THREE.Vector3(pe.x, y + (pe.seated ? 0.82 : 1.62), pe.z), q, one); this.heads.setMatrixAt(i, h);
      if (pe.seated) nb++; else ns++;
      void i;
    });
    this.standing.count = ns; this.seatedBody.count = nb; this.heads.count = this.people.length;
    this.standing.instanceMatrix.needsUpdate = this.seatedBody.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = true;
    // colours were set per person index: keep them aligned with the placement order by rewriting them
    let a = 0, b = 0; this.people.forEach((pe) => { const c = new THREE.Color(CLOTHES[pe.cloth % CLOTHES.length]); if (pe.seated) this.seatedBody.setColorAt(b++, c); else this.standing.setColorAt(a++, c); });
    if (this.standing.instanceColor) this.standing.instanceColor.needsUpdate = true; if (this.seatedBody.instanceColor) this.seatedBody.instanceColor.needsUpdate = true;
  }
  dispose() { this.group.traverse((o) => { (o as THREE.Mesh).geometry?.dispose?.(); }); }
}

/** A repeatable pseudo-random number generator (so the same terminal has the same crowd). */
export function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
