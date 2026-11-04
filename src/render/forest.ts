// Dense forest and woodland around the camera: instanced conifers and broadleaf trees placed on the land-cover "tree" class
// (and some scattered trees in gardens / built-up edges), re-centred as the camera moves. Heavy by design.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../world/world';
import { LC } from '../world/world';

const hash = (a: number, b: number, s = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 144665231);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function paint(g: THREE.BufferGeometry, r: number, gr: number, b: number) {
  const ng = g.index ? g.toNonIndexed() : g, n = ng.getAttribute('position').count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3)); ng.deleteAttribute('uv'); return ng;
}

export class Forest {
  readonly group = new THREE.Group();
  count = 0;
  private cx = 1e9; private cz = 1e9;
  private meshes: THREE.InstancedMesh[] = [];
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private conifer: THREE.BufferGeometry; private broad: THREE.BufferGeometry;

  constructor(private world: World, private radius = 3200, private step = 9) {
    const trunk = () => paint(new THREE.CylinderGeometry(0.22, 0.38, 3.4, 5).translate(0, 1.7, 0), 0.26, 0.19, 0.12);
    this.conifer = mergeGeometries([trunk(),
      paint(new THREE.ConeGeometry(2.6, 6.5, 7).translate(0, 5.6, 0), 0.08, 0.2, 0.1),
      paint(new THREE.ConeGeometry(2.0, 5.5, 7).translate(0, 8.9, 0), 0.07, 0.19, 0.09),
      paint(new THREE.ConeGeometry(1.3, 4.5, 7).translate(0, 12.0, 0), 0.06, 0.18, 0.08)])!;
    this.broad = mergeGeometries([trunk(),
      paint(new THREE.IcosahedronGeometry(3.6, 1).scale(1, 0.85, 1).translate(0, 7.0, 0), 0.14, 0.27, 0.08),
      paint(new THREE.IcosahedronGeometry(2.4, 1).translate(1.6, 8.6, 0.8), 0.17, 0.31, 0.09)])!;
    this.group.name = 'forest';
  }

  /** Re-centre when the camera has moved far enough. */
  update(cam: THREE.Vector3) {
    if (Math.hypot(cam.x - this.cx, cam.z - this.cz) < 450) return;
    this.cx = cam.x; this.cz = cam.z;
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    const cs: THREE.Matrix4[] = [], bs: THREE.Matrix4[] = [], cc: THREE.Color[] = [], bc: THREE.Color[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const R = this.radius, st = this.step, E0 = cam.x, N0 = -cam.z, r2 = R * R;
    const i0 = Math.floor((E0 - R) / st), i1 = Math.floor((E0 + R) / st), j0 = Math.floor((N0 - R) / st), j1 = Math.floor((N0 + R) / st);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const e = (i + hash(i, j, 1)) * st, n = (j + hash(i, j, 2)) * st;
      if ((e - E0) ** 2 + (n - N0) ** 2 > r2) continue;
      const lc = this.world.landAt(e, n);
      const dense = lc === LC.TREE;
      if (!dense && !(lc === LC.SHRUB && hash(i, j, 9) < 0.25) && !(lc === LC.BUILT && hash(i, j, 9) < 0.06)) continue;
      if (dense && hash(i, j, 3) > 0.9) continue; // small clearings
      if (this.world.isPaved(e, n)) continue;
      const hgt = this.world.terrain.heightAt(e, n);
      if (hgt < 1.2) continue;
      const kind = hash(i >> 3, j >> 3, 4) < 0.55 ? hash(i, j, 5) < 0.85 : hash(i, j, 5) < 0.2; // stands of the same species
      const s = (dense ? 0.75 : 0.55) + hash(i, j, 6) * 0.8;
      q.setFromAxisAngle(up, hash(i, j, 7) * 6.283); pos.set(e, hgt - 0.3, -n); sc.set(s, s * (0.85 + hash(i, j, 8) * 0.5), s);
      m4.compose(pos, q, sc);
      const t = 0.7 + hash(i, j, 10) * 0.5, col = new THREE.Color(t, t * (0.96 + hash(i, j, 11) * 0.12), t * 0.92);
      if (kind) { cs.push(m4.clone()); cc.push(col); } else { bs.push(m4.clone()); bc.push(col); }
    }
    this.count = cs.length + bs.length;
    for (const [geo, ms, cols] of [[this.conifer, cs, cc], [this.broad, bs, bc]] as const) {
      if (!ms.length) continue;
      const im = new THREE.InstancedMesh(geo, this.mat, ms.length);
      ms.forEach((mm, k) => { im.setMatrixAt(k, mm); im.setColorAt(k, cols[k]); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.frustumCulled = true;
      this.meshes.push(im); this.group.add(im);
    }
  }
}
