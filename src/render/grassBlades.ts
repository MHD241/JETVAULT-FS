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
  private geo: THREE.BufferGeometry;
  private geoFar: THREE.BufferGeometry;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private uTime = { value: 0 };
  constructor(private world: World, _radius = 30, _step = 0.26) {
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
    this.geo = mergeGeometries(blades)!; this.geoFar = mergeGeometries(blades.slice(0, 3))!;   // far rings: 3 blades per tuft, flattened this.group.name = 'grassblades';
  }
  /** Three rings so the grass reaches far but stays light: fine tufts near the camera, then bigger tufts out to 200 m. Beyond that the terrain shader carries the grass look (single big blades read as random triangles from far away). */
  private rings: { r0: number; r1: number; step: number; scale: number; thresh: number; cap: number; flat?: number; mesh: THREE.InstancedMesh | null; cx: number; cz: number; keep: number }[] = [
    { r0: 0.5, r1: 24, step: 0.3, scale: 1, thresh: 8, cap: 30000, mesh: null as THREE.InstancedMesh | null, cx: 1e9, cz: 1e9, keep: -1 },
    { r0: 24, r1: 80, step: 0.85, scale: 2.4, thresh: 18, cap: 34000, mesh: null as THREE.InstancedMesh | null, cx: 1e9, cz: 1e9, keep: -1 },
    { r0: 80, r1: 200, step: 2.0, scale: 5.5, thresh: 40, cap: 34000, mesh: null as THREE.InstancedMesh | null, cx: 1e9, cz: 1e9, keep: -1 },
  ];
  /** Fraction kept for a camera height above ground: everything below 30 m, then a slow thinning, last tufts gone at ~650 m. */
  static keepFor(agl: number) { return 1 - Math.min(1, Math.max(0, (agl - 30) / 620)); }
  update(cam: THREE.Vector3, agl = 0, time = 0) {
    this.uTime.value = time;
    const keep = GrassBlades.keepFor(agl);
    if (keep <= 0.02) { this.group.visible = false; return; }
    this.group.visible = true;
    for (const rg of this.rings) {
      if (rg.mesh && Math.hypot(cam.x - rg.cx, cam.z - rg.cz) < rg.thresh && Math.abs(keep - rg.keep) < 0.06) continue;
      rg.keep = keep; rg.cx = cam.x; rg.cz = cam.z;
      if (rg.mesh) { this.group.remove(rg.mesh); rg.mesh.dispose(); rg.mesh = null; }
      const st = rg.step, E0 = cam.x, N0 = -cam.z, R = rg.r1, r2 = R * R, in2 = rg.r0 * rg.r0;
      const mats: THREE.Matrix4[] = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      const i0 = Math.floor((E0 - R) / st), i1 = Math.floor((E0 + R) / st), j0 = Math.floor((N0 - R) / st), j1 = Math.floor((N0 + R) / st);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const e = (i + hash(i, j, 1)) * st, n = (j + hash(i, j, 2)) * st, d2 = (e - E0) ** 2 + (n - N0) ** 2;
        if (d2 > r2 || d2 < in2 || mats.length >= rg.cap) continue;
        if (hash(i, j, 11) > keep) continue;                              // thin out progressively with altitude
        const lc = this.world.landAt(e, n);
        if (lc !== LC.GRASS && lc !== LC.CROP) continue;
        if (this.world.isPaved(e, n)) continue;
        const h = this.world.terrain.heightAt(e, n);
        pos.set(e, h, -n); q.setFromAxisAngle(up, hash(i, j, 3) * 6.283); const s = rg.scale * (0.8 + 0.7 * hash(i, j, 4)); sc.set(s, s * (0.8 + 0.5 * hash(i, j, 5)) * (rg.flat ?? 1), s);
        mats.push(m4.compose(pos, q, sc).clone());
      }
      const im = new THREE.InstancedMesh(rg.flat ? this.geoFar : this.geo, this.mat, mats.length);
      mats.forEach((m, k) => im.setMatrixAt(k, m)); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
      rg.mesh = im; this.group.add(im);
    }
  }
}
