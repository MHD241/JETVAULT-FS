// PRO only: real 3D grass blades around the camera (instanced tufts of tapered blades, dark at the root and light at the tip),
// placed on grass/crop land and re-centred as the camera moves. One draw call; only within RADIUS metres so it stays light.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../world/world';
import { LC } from '../world/world';

const hash = (a: number, b: number, s = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 144665231);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class GrassBlades {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private cx = 1e9; private cz = 1e9;
  private geo: THREE.BufferGeometry;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  constructor(private world: World, private radius = 38, private step = 0.5) {
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + k, h = 0.16 + 0.12 * ((k * 37) % 7) / 7, w = 0.022;
      const g = new THREE.BufferGeometry();
      const lean = 0.07 + 0.05 * (k % 3), ox = Math.cos(a) * 0.05, oz = Math.sin(a) * 0.05;
      const dx = Math.cos(a + 1.57) * w, dz = Math.sin(a + 1.57) * w, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
      g.setAttribute('position', new THREE.Float32BufferAttribute([ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + lx, h, oz + lz], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.05, 0.10, 0.03, 0.05, 0.10, 0.03, 0.24, 0.36, 0.12], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      blades.push(g);
    }
    this.geo = mergeGeometries(blades)!; this.group.name = 'grassblades';
  }
  update(cam: THREE.Vector3) {
    if (Math.hypot(cam.x - this.cx, cam.z - this.cz) < 8 && this.mesh) return;
    this.cx = cam.x; this.cz = cam.z;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    const R = this.radius, st = this.step, E0 = cam.x, N0 = -cam.z, r2 = R * R;
    const mats: THREE.Matrix4[] = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const i0 = Math.floor((E0 - R) / st), i1 = Math.floor((E0 + R) / st), j0 = Math.floor((N0 - R) / st), j1 = Math.floor((N0 + R) / st);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const e = (i + hash(i, j, 1)) * st, n = (j + hash(i, j, 2)) * st, d2 = (e - E0) ** 2 + (n - N0) ** 2;
      if (d2 > r2 || mats.length >= 14000) continue;
      if (hash(i, j, 7) > 1 - 0.85 * (d2 / r2) * 0.9 - 0.0 && d2 > r2 * 0.25) continue; // thin out with distance
      const lc = this.world.landAt(e, n);
      if (lc !== LC.GRASS && lc !== LC.CROP) continue;
      if (this.world.isPaved(e, n)) continue;
      const h = this.world.terrain.heightAt(e, n);
      pos.set(e, h, -n); q.setFromAxisAngle(up, hash(i, j, 3) * 6.283); const s = 0.8 + 0.7 * hash(i, j, 4); sc.set(s, s * (0.8 + 0.5 * hash(i, j, 5)), s);
      mats.push(m4.compose(pos, q, sc).clone());
    }
    const im = new THREE.InstancedMesh(this.geo, this.mat, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m)); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
    this.mesh = im; this.group.add(im);
  }
}
