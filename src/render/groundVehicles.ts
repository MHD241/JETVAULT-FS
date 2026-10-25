// Parked ground service equipment around each airliner stand (original low-poly vehicles, instanced):
// baggage tractor with two carts, a fuel truck under the right wing and a ground power unit.
// Placement is relative to the stand's aircraft datum and heading; it is illustrative, not a record of real vehicles.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { enuToThree } from './coords';

const hash = (a: number, b: number) => {
  let h = Math.imul(Math.round(a * 8), 374761393) ^ Math.imul(Math.round(b * 8), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const C = (hex: number) => new THREE.Color(hex);
function box(w: number, h: number, l: number, x: number, y: number, z: number, col: number) {
  const g = new THREE.BoxGeometry(w, h, l).translate(x, y, z);
  return paint(g, col);
}
function cyl(r: number, len: number, x: number, y: number, z: number, col: number, alongZ: boolean, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (alongZ) g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, col);
}
function paint(g: THREE.BufferGeometry, hex: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = C(hex), n = ng.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  ng.deleteAttribute('uv');
  return ng;
}
const wheels = (xs: number[], zs: number[], r: number) => xs.flatMap((x) => zs.map((z) => cyl(r, 0.28, x, r, z, 0x16181b, false)));

/** Authored with the front towards -z, +x right, +y up, origin on the ground at the middle. */
const fuelTruck = () => mergeGeometries([
  box(2.5, 0.7, 8.2, 0, 0.75, 0.3, 0x2b2f35),
  cyl(1.15, 5.4, 0, 1.95, 1.3, 0xe6e8ea, true, 16),
  box(2.4, 1.9, 1.9, 0, 1.75, -3.2, 0xc8302a),
  box(2.2, 0.75, 0.08, 0, 2.2, -4.17, 0x25323c),
  ...wheels([-1.15, 1.15], [-2.9, 1.8, 3.2], 0.55),
])!;
const tractor = () => mergeGeometries([
  box(1.4, 0.8, 2.3, 0, 0.7, 0, 0xe8b21c),
  box(1.3, 0.1, 1.1, 0, 1.95, 0.35, 0x23272e),
  ...[-0.62, 0.62].map((x) => box(0.08, 1.2, 0.08, x, 1.4, -0.15, 0x23272e)),
  box(0.08, 1.2, 0.08, -0.62, 1.4, 0.9, 0x23272e), box(0.08, 1.2, 0.08, 0.62, 1.4, 0.9, 0x23272e),
  ...wheels([-0.7, 0.7], [-0.8, 0.8], 0.36),
])!;
const cart = () => mergeGeometries([
  box(1.8, 0.2, 3.0, 0, 0.45, 0, 0x4b5057),
  box(1.7, 1.0, 2.7, 0, 1.05, 0, 0x7d8a96), // loaded container
  box(1.74, 0.06, 2.74, 0, 1.58, 0, 0x5d6975),
  ...wheels([-0.8, 0.8], [-1.1, 1.1], 0.22),
])!;
const gpu = () => mergeGeometries([
  box(1.1, 1.0, 1.9, 0, 0.75, 0, 0xe8b21c),
  box(1.0, 0.6, 0.6, 0, 1.55, 0.4, 0xe8b21c),
  ...wheels([-0.55, 0.55], [-0.6, 0.6], 0.25),
])!;

export interface VehicleSite { east: number; north: number; heading: number } // heading: compass rad of the parked aircraft nose

export class GroundVehicles {
  readonly group = new THREE.Group();
  count = 0;

  constructor(sites: VehicleSite[], groundAt: (e: number, n: number) => number) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const lists: Record<string, THREE.Matrix4[]> = { fuel: [], tractor: [], cart: [], gpu: [] };
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    sites.forEach((s) => {
      const f = [Math.sin(s.heading), Math.cos(s.heading)], r = [Math.cos(s.heading), -Math.sin(s.heading)];
      const put = (kind: string, ax: number, ay: number, yaw: number) => {
        const e = s.east + f[0] * ax + r[0] * ay, n = s.north + f[1] * ax + r[1] * ay;
        p.copy(enuToThree(e, n, groundAt(e, n)));
        q.setFromAxisAngle(up, -(s.heading + yaw));
        lists[kind].push(new THREE.Matrix4().compose(p, q, one));
      };
      const k = hash(s.east, s.north);
      put('gpu', 8.5, 4.0, Math.PI / 2);                       // ground power, beside the nose on the right
      if (k < 0.8) { put('tractor', 4.0, 7.6, 0); put('cart', 0.5, 7.6, 0); if (k < 0.55) put('cart', -3.0, 7.6, 0); }
      if (k > 0.25) put('fuel', -5.5, 18.5, hash(s.north, s.east) < 0.5 ? 0 : Math.PI);   // under the right wing
    });
    const geos: Record<string, THREE.BufferGeometry> = { fuel: fuelTruck(), tractor: tractor(), cart: cart(), gpu: gpu() };
    for (const [kind, ms] of Object.entries(lists)) {
      if (!ms.length) continue;
      const im = new THREE.InstancedMesh(geos[kind], mat, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      this.group.add(im);
      this.count += ms.length;
    }
    this.group.name = 'ground-vehicles';
  }
}
