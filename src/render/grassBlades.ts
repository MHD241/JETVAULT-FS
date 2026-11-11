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
  private uTime = { value: 0 };
  constructor(private world: World, private radius = 30, private step = 0.26) {
    // wind: every blade bends in the world wind direction, more towards its tip; slow swells travel across the field, with faster flutter on top
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp = instanceMatrix[3].xyz;
          float tip = position.y * position.y * 9.0;                       // 0 at the root, about 1 at the tip
          float swell = sin(uTime * 1.3 + wp.x * 0.18 + wp.z * 0.11) * 0.6 + sin(uTime * 0.7 - wp.x * 0.07 + wp.z * 0.2) * 0.4;
          float flutter = sin(uTime * 5.1 + wp.x * 1.7 + wp.z * 1.3 + position.y * 6.0) * 0.25;
          vec3 wind = vec3(1.0, 0.0, 0.35) * (0.10 + 0.09 * swell) + vec3(0.35, 0.0, -1.0) * 0.03 * flutter + vec3(1.0, 0.0, 0.35) * 0.03 * flutter;
          mat3 m3 = mat3(instanceMatrix);
          float s2 = max(dot(m3[0], m3[0]), 1e-4);
          transformed += (transpose(m3) * wind) / s2 * tip;
          transformed.y -= length(wind) * tip * 0.25;
        }`);
    };
    this.mat.customProgramCacheKey = () => 'grass-wind';
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + k, h = 0.26 + 0.22 * ((k * 37) % 7) / 7, w = 0.032;
      const g = new THREE.BufferGeometry();
      const lean = 0.07 + 0.05 * (k % 3), ox = Math.cos(a) * 0.05, oz = Math.sin(a) * 0.05;
      const dx = Math.cos(a + 1.57) * w, dz = Math.sin(a + 1.57) * w, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
      g.setAttribute('position', new THREE.Float32BufferAttribute([ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + lx, h, oz + lz], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.07, 0.14, 0.04, 0.07, 0.14, 0.04, 0.30, 0.46, 0.14], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      blades.push(g);
    }
    this.geo = mergeGeometries(blades)!; this.group.name = 'grassblades';
  }
  private lastKeep = -1;
  /** Fraction of blades kept for a camera height above ground: all of them near the ground, thinning out gradually (not all at once) until none at ~160 m. */
  static keepFor(agl: number) { return 1 - Math.min(1, Math.max(0, (agl - 6) / 150)); }
  update(cam: THREE.Vector3, agl = 0, time = 0) {
    this.uTime.value = time;
    const keep = GrassBlades.keepFor(agl);
    if (keep <= 0.02) { this.group.visible = false; return; }
    this.group.visible = true;
    if (Math.hypot(cam.x - this.cx, cam.z - this.cz) < 10 && this.mesh && Math.abs(keep - this.lastKeep) < 0.06) return;
    this.lastKeep = keep; this.cx = cam.x; this.cz = cam.z;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    const R = this.radius, st = this.step, E0 = cam.x, N0 = -cam.z, r2 = R * R;
    const mats: THREE.Matrix4[] = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const i0 = Math.floor((E0 - R) / st), i1 = Math.floor((E0 + R) / st), j0 = Math.floor((N0 - R) / st), j1 = Math.floor((N0 + R) / st);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const e = (i + hash(i, j, 1)) * st, n = (j + hash(i, j, 2)) * st, d2 = (e - E0) ** 2 + (n - N0) ** 2;
      if (d2 > r2 || d2 < 0.5 * 0.5 || mats.length >= 45000) continue;   // nothing right at the camera
      if (hash(i, j, 11) > keep) continue;                              // thin out progressively with altitude
      if (hash(i, j, 7) > 1 - 0.7 * (d2 / r2) && d2 > r2 * 0.2) continue; // thin out with distance
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
