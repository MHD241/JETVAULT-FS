// Dense forest and woodland around the camera: instanced conifers and broadleaf trees placed on the land-cover "tree" class
// (and some scattered trees in gardens / built-up edges), re-centred as the camera moves. Heavy by design.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
  private mat: THREE.MeshLambertMaterial;
  private conifer: THREE.BufferGeometry; private broad: THREE.BufferGeometry;
  private aerial: (sh: { vertexShader: string; fragmentShader: string }) => void;
  private texMat: THREE.MeshLambertMaterial | null = null;

  constructor(private world: World, private radius = 3200, private step = 9) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.aerial = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvFPos = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;');
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vFPos;\nvoid main() {');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec3 vFPos;\nvoid main() {');
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>',
        'float dF = length(vFPos - cameraPosition);\n' +
        'float aerF = (1.0 - exp(-dF * 0.00012)) * 0.65;\n' +
        'float lumF = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));\n' +
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lumF) * 1.03, clamp(aerF, 0.0, 0.65));\n' +
        '#include <fog_fragment>');
    };
    mat.onBeforeCompile = this.aerial;
    this.mat = mat;
    const trunk = () => paint(new THREE.CylinderGeometry(0.22, 0.38, 3.4, 5).translate(0, 1.7, 0), 0.22, 0.16, 0.10);
    this.conifer = mergeGeometries([trunk(),
      paint(new THREE.ConeGeometry(2.6, 6.5, 7).translate(0, 5.6, 0), 0.06, 0.14, 0.08),
      paint(new THREE.ConeGeometry(2.0, 5.5, 7).translate(0, 8.9, 0), 0.05, 0.13, 0.07),
      paint(new THREE.ConeGeometry(1.3, 4.5, 7).translate(0, 12.0, 0), 0.045, 0.12, 0.065)])!;
    this.broad = mergeGeometries([trunk(),
      paint(new THREE.IcosahedronGeometry(3.6, 1).scale(1, 0.85, 1).translate(0, 7.0, 0), 0.10, 0.19, 0.06),
      paint(new THREE.IcosahedronGeometry(2.4, 1).translate(1.6, 8.6, 0.8), 0.12, 0.22, 0.07)])!;
    this.group.name = 'forest';
    // "Tree low poly lowpoly" by 00amza (CC BY 4.0): replaces the plain cone / blob trees once it has loaded
    if (typeof document !== 'undefined') new GLTFLoader().load('./models/tree.glb', (g) => {
      g.scene.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = []; let map: THREE.Texture | null = null;
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const gm = m.geometry.clone().applyMatrix4(m.matrixWorld);
        gm.computeBoundingBox(); const bb = gm.boundingBox!, c = bb.getCenter(new THREE.Vector3());
        gm.translate(-c.x, -bb.min.y, -c.z); gm.scale(1.4, 1.4, 1.4);
        for (const k of Object.keys(gm.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gm.deleteAttribute(k);
        geos.push(gm);
        map ??= (m.material as THREE.MeshStandardMaterial).map;
      });
      if (geos.length < 2 || !map) return;
      const tm = new THREE.MeshLambertMaterial({ map, alphaTest: 0.4, side: THREE.DoubleSide });
      tm.onBeforeCompile = this.aerial;
      this.texMat = tm; this.conifer = geos[0]; this.broad = geos[1];
      this.cx = 1e9; this.cz = 1e9;
    });
  }

  private apBoxC: { a: number; c: number; d: number; f: number } | null = null;
  private get apBox() { return this.apBoxC ??= (() => { const b = this.world.airport.boundary; let a = 1e9, c = -1e9, d = 1e9, f = -1e9; for (const [x, y] of b) { a = Math.min(a, x); c = Math.max(c, x); d = Math.min(d, y); f = Math.max(f, y); } return { a, c, d, f }; })(); }
  /** True inside the airport fence polygon, within 120 m outside it, or within 220 m of any runway (so no trees by the runway, taxiways, aprons or terminal). */
  private inAirport(e: number, n: number): boolean {
    const bb = this.apBox, m = 120;
    if (e > bb.a - m && e < bb.c + m && n > bb.d - m && n < bb.f + m) {
      const poly = this.world.airport.boundary; let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
      // outside the polygon but near its edge: distance to the polygon edges
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [x0, y0] = poly[j], [x1, y1] = poly[i], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((e - x0) * dx + (n - y0) * dy) / L2));
        if (Math.hypot(e - (x0 + t * dx), n - (y0 + t * dy)) < m) return true;
      }
    }
    for (const rw of this.world.airport.runways) {
      const [a, b] = rw.ends, dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((e - a.x) * dx + (n - a.y) * dy) / L2));
      if (Math.hypot(e - (a.x + t * dx), n - (a.y + t * dy)) < 220) return true;
    }
    return false;
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
      if (this.world.roadTest?.(e, n)) continue;   // no trees on the road
      const dense = lc === LC.TREE;
      if (!dense && !(lc === LC.SHRUB && hash(i, j, 9) < 0.25) && !(lc === LC.BUILT && hash(i, j, 9) < 0.06)) continue;
      if (dense && hash(i, j, 3) > 0.9) continue; // small clearings
      if (this.world.isPaved(e, n) || this.inAirport(e, n)) continue;   // no trees anywhere in the airport space
      const hgt = this.world.terrain.heightAt(e, n);
      if (hgt < 1.2) continue;
      const kind = hash(i >> 3, j >> 3, 4) < 0.55 ? hash(i, j, 5) < 0.85 : hash(i, j, 5) < 0.2; // stands of the same species
      const s = (dense ? 0.75 : 0.55) + hash(i, j, 6) * 0.8;
      q.setFromAxisAngle(up, hash(i, j, 7) * 6.283); pos.set(e, hgt - 0.3, -n); sc.set(s, s * (0.85 + hash(i, j, 8) * 0.5), s);
      m4.compose(pos, q, sc);
      const t = 0.72 + hash(i, j, 10) * 0.56;
      const hue = hash(i, j, 11);
      const col = hue < 0.35 ? new THREE.Color(t * 0.92, t, t * 0.88)          // cool green
        : hue < 0.6 ? new THREE.Color(t, t * 0.96, t * 0.82)                   // olive
        : hue < 0.82 ? new THREE.Color(t * 1.04, t * 0.98, t * 0.76)           // warm yellow-green
        : new THREE.Color(t * 0.88, t * 0.92, t * 0.84);                        // dark muted
      if (kind) { cs.push(m4.clone()); cc.push(col); } else { bs.push(m4.clone()); bc.push(col); }
    }
    this.count = cs.length + bs.length;
    for (const [geo, ms, cols] of [[this.conifer, cs, cc], [this.broad, bs, bc]] as const) {
      if (!ms.length) continue;
      const im = new THREE.InstancedMesh(geo, this.texMat ?? this.mat, ms.length);
      ms.forEach((mm, k) => { im.setMatrixAt(k, mm); im.setColorAt(k, cols[k]); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.frustumCulled = true;
      im.castShadow = true; im.receiveShadow = true;
      this.meshes.push(im); this.group.add(im);
    }
  }
}
