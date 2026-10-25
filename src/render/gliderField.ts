// Scenery for the gliding site (all original, simple geometry): trees from the land-cover map,
// winch-launch markers, a windsock, parked gliders, and the retrieval buggy.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../world/world';
import { LC } from '../world/world';
import type { AirportData } from '../world/airport';
import type { Building } from '../world/obstacles';
import type { LaunchPoint } from '../sim/buggy';
import { enuToThree } from './coords';

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function paint(g: THREE.BufferGeometry, r: number, gr: number, b: number) {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const nonIndexed = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** Instanced trees (conifers and broadleaves) on the land-cover tree class around a point. */
export class TreeField {
  readonly group = new THREE.Group();
  count = 0;

  constructor(world: World, centre: { e: number; n: number }, radius: number, buildings: Building[], runwaySegs: [number, number, number, number][], step = 16) {
    const trunk = () => paint(nonIndexed(new THREE.CylinderGeometry(0.25, 0.4, 3, 5).translate(0, 1.5, 0)), 0.32, 0.22, 0.13);
    const conifer = mergeGeometries([trunk(), paint(nonIndexed(new THREE.ConeGeometry(2.2, 9, 7).translate(0, 7.2, 0)), 0.12, 0.28, 0.14)])!;
    const broad = mergeGeometries([trunk(), paint(nonIndexed(new THREE.IcosahedronGeometry(3.4, 0).scale(1, 0.9, 1).translate(0, 6.2, 0)), 0.2, 0.36, 0.13)])!;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cs: THREE.Matrix4[] = [], bs: THREE.Matrix4[] = [], cc: THREE.Color[] = [], bc: THREE.Color[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const ax = new THREE.Vector3(0, 1, 0);
    const r2 = radius * radius;
    for (let de = -radius; de <= radius; de += step) {
      for (let dn = -radius; dn <= radius; dn += step) {
        if (de * de + dn * dn > r2) continue;
        const ci = Math.round(de / step), cj = Math.round(dn / step);
        const e = centre.e + de + (hash(ci, cj) - 0.5) * step * 0.9, n = centre.n + dn + (hash(cj, ci + 77) - 0.5) * step * 0.9;
        if (world.landAt(e, n) !== LC.TREE) continue;
        if (hash(ci + 5, cj + 9) > 0.62) continue; // thin the canopy
        let skip = false;
        for (const s of runwaySegs) {
          const [x0, y0, x1, y1] = s;
          const vx = x1 - x0, vy = y1 - y0, t = Math.max(0, Math.min(1, ((e - x0) * vx + (n - y0) * vy) / (vx * vx + vy * vy)));
          if (Math.hypot(e - (x0 + vx * t), n - (y0 + vy * t)) < 45) { skip = true; break; }
        }
        if (skip) continue;
        for (const b of buildings) if (e > b.minE - 4 && e < b.maxE + 4 && n > b.minN - 4 && n < b.maxN + 4) { skip = true; break; }
        if (skip) continue;
        const h = world.terrain.heightAt(e, n);
        const kind = hash(ci * 3, cj * 7) < 0.45;
        const s = 0.7 + hash(cj, ci) * 0.9;
        q.setFromAxisAngle(ax, hash(ci, cj + 3) * 6.28);
        pos.set(e, h - 0.3, -n);
        sc.set(s, s * (0.9 + hash(ci + 1, cj) * 0.4), s);
        m.compose(pos, q, sc);
        const tint = new THREE.Color().setScalar(0.75 + hash(ci + 11, cj + 13) * 0.4);
        if (kind) { cs.push(m.clone()); cc.push(tint); } else { bs.push(m.clone()); bc.push(tint); }
      }
    }
    for (const [geo, ms, cols] of [[conifer, cs, cc], [broad, bs, bc]] as const) {
      if (!ms.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, ms.length);
      ms.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
    this.count = cs.length + bs.length;
    this.group.name = 'trees';
  }
}

/** Launch-point cones and boards, a windsock and a row of parked gliders beside the field. */
export class FieldScenery {
  readonly group = new THREE.Group();
  private sock: THREE.Group;
  private rings: THREE.Mesh[] = [];

  constructor(ap: AirportData, world: World, launch: LaunchPoint[]) {
    const orange = new THREE.MeshLambertMaterial({ color: 0xff6a1a }), white = new THREE.MeshLambertMaterial({ color: 0xf2f4f6 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x23272e }), red = new THREE.MeshLambertMaterial({ color: 0xc02820 });
    const put = (o: THREE.Object3D, e: number, n: number, up = 0) => { o.position.copy(enuToThree(e, n, world.terrain.heightAt(e, n) + up)); this.group.add(o); return o; };
    // launch points: a row of cones either side and a board
    for (const lp of launch) {
      const fx = Math.sin(lp.heading), fy = Math.cos(lp.heading), rx = fy, ry = -fx;
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 10), orange);
        put(c, lp.east + rx * side * 11 - fx * k * 6, lp.north + ry * side * 11 - fy * k * 6, 0.35);
      }
      const board = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.6, 0.12), dark); post.position.y = 2.3;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 0.08), orange); sign.position.y = 4.4;
      sign.rotation.y = -(lp.heading + Math.PI / 2);
      board.add(post, sign);
      put(board, lp.east + rx * 14, lp.north + ry * 14);
    }
    // windsock beside the middle of the runway
    const rw = ap.runways[0];
    const [a, b] = rw.ends;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    this.sock = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 7, 8), white); pole.position.y = 3.5;
    this.sock.add(pole);
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.065, 0.48 - i * 0.065, 0.62, 10, 1, true), i % 2 ? white : orange);
      (r.material as THREE.Material).side = THREE.DoubleSide;
      r.rotation.z = Math.PI / 2; r.position.set(0.31 + i * 0.62 + 0.3, 7, 0);
      this.rings.push(r);
    }
    const arm = new THREE.Group(); arm.name = 'arm'; arm.position.y = 0;
    arm.add(...this.rings);
    this.sock.add(arm);
    put(this.sock, mx - (dy / L) * 55, my + (dx / L) * 55);
    // parked gliders: white fuselage, long wing, tail; wings level, nose along the runway
    const hdg = Math.atan2(dx, dy);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.12, 8, 8), white); fus.rotation.x = Math.PI / 2; fus.position.y = 0.9;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(17, 0.08, 0.95), white); wing.position.set(0, 1.3, -0.5);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 1.0), white); fin.position.set(0, 1.5, 3.8);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 0.6), white); tail.position.set(0, 1.9, 3.9);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), i % 2 ? red : orange); nose.position.set(0, 0.95, -3.9);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10), dark); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.16, -1.2);
      g.add(fus, wing, fin, tail, nose, wheel);
      g.rotation.y = -hdg + Math.PI + (hash(i, 3) - 0.5) * 0.15;
      const along = -230 + i * 38 + hash(i, 9) * 12;
      put(g, mx + (dx / L) * along - (dy / L) * 80, my + (dy / L) * along + (dx / L) * 80);
    }
    this.group.name = 'glider-field';
  }

  /** Point the sock downwind and stretch it with the wind strength. */
  update(windFromDeg: number, windKt: number, t: number) {
    const to = ((windFromDeg + 180) * Math.PI) / 180;
    this.sock.rotation.y = -(to - Math.PI / 2); // arm points +x at rotation 0 (east); to = compass heading
    const lift = Math.min(1, windKt / 12);
    this.rings.forEach((r, i) => {
      r.position.y = 7 - (1 - lift) * (0.2 + i * 0.35) + Math.sin(t * 5 + i) * 0.03 * lift;
    });
  }
}

/** The retrieval buggy (a small pickup). Authored with the front towards -z (three.js forward). */
export class BuggyModel {
  readonly group = new THREE.Group();
  readonly beacon: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private cab: THREE.Mesh;

  constructor() {
    const body = new THREE.MeshStandardMaterial({ color: 0xe8b21c, roughness: 0.55 }), dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x25313c, roughness: 0.2, metalness: 0.4 });
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.7, 4.3), body); lower.position.set(0, 0.75, 0);
    this.cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.7), glass); this.cab.position.set(0, 1.45, -0.5);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 1.7), body); bed.position.set(0, 1.2, 1.2);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 0.2), dark); bumper.position.set(0, 0.5, -2.2);
    const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.5), dark); hitch.position.set(0, 0.55, 2.3);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9a00 })); this.beacon.position.set(0, 1.95, -0.5);
    this.group.add(lower, this.cab, bed, bumper, hitch, this.beacon);
    for (const sx of [-0.9, 0.9]) for (const z of [-1.3, 1.3]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.28, 14), dark);
      w.rotation.z = Math.PI / 2; w.position.set(sx, 0.4, z); this.wheels.push(w); this.group.add(w);
    }
    this.group.visible = false;
  }

  /** east/north in the world frame, heading (compass rad), ground heights under the front/rear axle. */
  setPose(e: number, n: number, heading: number, hCentre: number, hFront: number, hRear: number) {
    this.group.position.copy(enuToThree(e, n, hCentre));
    this.group.rotation.set(Math.atan2(hFront - hRear, 2.6), -heading, 0, 'YXZ');
  }
}
