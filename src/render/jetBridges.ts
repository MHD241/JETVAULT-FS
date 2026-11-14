// Passenger boarding bridges at the OSM gate positions (visual only, no collision).
// Each bridge rests swung ~28 degrees off the wall normal and can be driven to a parked
// airliner's forward-left door (connect) and back. Lengths and door position are estimates.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Building, findGateSites } from '../world/obstacles';
import { Aircraft } from '../sim/fdm/aircraft';
import { Vec3 } from '../core/math';
import { nedToThree } from './coords';

const REST_LEN = 18; // m, pivot to cab centre when stowed
const REST_SWING = 0.49; // rad (~28 deg) off the outward wall normal
const FLOOR = 3.6; // m above ground, stowed
const DOOR_RANGE = 85; // m, pivot to door
/** 737-800 forward-left door (L1) centre, body FRD metres: ~4.9 m behind the nose, left side. ESTIMATE. */
const DOOR_BODY = new Vec3(12.8, -1.9, 0.0);
const DOOR_SILL_ABOVE_GROUND = 2.6;

function tint(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
  return g;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const toward = (v: number, t: number, step: number) => (Math.abs(t - v) <= step ? t : v + Math.sign(t - v) * step);

const tubeCol = new THREE.Color(0.40, 0.44, 0.50), dark = new THREE.Color(0.10, 0.12, 0.15), light = new THREE.Color(0.80, 0.82, 0.85), yellow = new THREE.Color(0.95, 0.75, 0.08);

/** The "Jetway" model (vishnevsky.yaroslav, CC BY 4.0), split into rigged parts. Model frame: the bridge runs along +z from the rotunda (z about 0) to the cab centre (z about 21.6), y up. */
interface ModelParts { rotunda: { g: THREE.BufferGeometry; m: THREE.Material }[]; arm: { g: THREE.BufferGeometry; m: THREE.Material }[]; tel: { g: THREE.BufferGeometry; m: THREE.Material }[]; col: { g: THREE.BufferGeometry; m: THREE.Material }[] }
const MODEL_LEN0 = 21.6, MODEL_FLOOR0 = 5.4;
interface Rig { swing: THREE.Group; arm: THREE.Group; tel: THREE.Group; col: THREE.Group; wall: number }

interface Bridge {
  group: THREE.Group; tube: THREE.Mesh | null; end: THREE.Mesh | null; rig?: Rig;
  px: number; pz: number; base: number; restYaw: number;
  yaw: number; len: number; floor: number;
  connected: boolean;
}

export class JetBridges {
  readonly group = new THREE.Group();
  private bridges: Bridge[] = [];
  private active: Bridge | null = null;
  private owned = new Map<string, { bridges: Bridge[]; paint: THREE.Mesh | null; geos: THREE.BufferGeometry[]; mat: THREE.Material }>();

  private parts: ModelParts | null = null;
  private pending: [string, [number, number][], Building[], (e: number, n: number) => number][] = [];
  private loading = true;
  private restLen = REST_LEN; private minLen = 6; private maxLen = 90;

  constructor() {
    this.group.name = 'jet bridges';
    new GLTFLoader().load('./models/jetway.glb', (g) => {
      g.scene.updateMatrixWorld(true);
      const P: ModelParts = { rotunda: [], arm: [], tel: [], col: [] };
      const roleOf: Record<string, keyof ModelParts> = { SM_Jetway2_0: 'rotunda', SM_Jetway_1: 'arm', SM_Jetway4_5: 'tel', SM_Jetway3_6: 'tel', SM_JetwayGlass_7: 'tel', SM_Jetway1_2: 'col', SM_Jetway6_3: 'col', SM_Jetway5_4: 'col' };
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        let n: THREE.Object3D | null = m, role: keyof ModelParts | undefined;
        while (n && !role) { role = roleOf[n.name]; n = n.parent; }
        if (!role) return;
        P[role].push({ g: m.geometry.clone().applyMatrix4(m.matrixWorld), m: m.material as THREE.Material });
      });
      this.parts = P; this.restLen = 21; this.minLen = 19; this.maxLen = 38; this.loading = false;
      const q = this.pending; this.pending = []; for (const a of q) this.addPatch(...a);
    }, undefined, (e) => { console.warn('jetway model not loaded, using the simple bridge', e); this.loading = false; const q = this.pending; this.pending = []; for (const a of q) this.addPatch(...a); });
  }

  /** Streams an airport's boarding bridges in (called when its patch is loaded). */
  addPatch(id: string, gates: [number, number][], buildings: Building[], groundAt: (e: number, n: number) => number) {
    this.removePatch(id);
    if (this.loading) { this.pending.push([id, gates, buildings, groundAt]); return; }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
    const tubeGeo = mergeGeometries([
      tint(new THREE.BoxGeometry(1, 3.0, 3.6).translate(0.5, 0, 0), tubeCol),
      tint(new THREE.BoxGeometry(1, 0.2, 3.8).translate(0.5, 1.55, 0), light),
      tint(new THREE.BoxGeometry(0.92, 0.8, 3.66).translate(0.5, 0.4, 0), dark),
    ].map((g) => g.toNonIndexed()))!;
    const endGeo = mergeGeometries([
      tint(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 16).translate(0, 0, 0), tubeCol),
      tint(new THREE.BoxGeometry(0.5, 7.0, 0.5).translate(-0.3, -4.3, 0), dark),
      tint(new THREE.BoxGeometry(2.2, 0.35, 1.2).translate(-0.3, -7.6, 0), dark),
    ].map((g) => g.toNonIndexed()))!;
    const paint: THREE.BufferGeometry[] = [];
    const mine: Bridge[] = [];
    for (const site of findGateSites(gates, buildings)) {
      const best = { px: site.px, py: site.py, nx: site.nx, ny: site.ny };
      const base = groundAt(best.px, best.py);
      const ang = Math.atan2(best.ny, best.nx);
      const restYaw = ang + REST_SWING;
      const group = new THREE.Group();
      group.position.set(best.px, base, -best.py);
      let tube: THREE.Mesh | null = null, end: THREE.Mesh | null = null, rig: Rig | undefined;
      if (this.parts) {
        // the model bridge: fixed rotunda, a swinging arm (main tunnel + telescoping inner tunnel and cab) and a support column that follows the cab
        const P = this.parts, mk = (list: { g: THREE.BufferGeometry; m: THREE.Material }[], parent: THREE.Object3D, dy = 0) => { for (const { g, m } of list) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.position.y = dy; parent.add(mesh); } };
        const wallG = new THREE.Group(); wallG.rotation.y = ang; const wallM = new THREE.Group(); wallM.rotation.y = Math.PI / 2; wallG.add(wallM); wallM.position.y = FLOOR - MODEL_FLOOR0;
        mk(P.rotunda, wallM);
        const swing = new THREE.Group(), m = new THREE.Group(); m.rotation.y = Math.PI / 2; swing.add(m);
        const arm = new THREE.Group(), tel = new THREE.Group(), col = new THREE.Group();
        mk(P.arm, arm, -MODEL_FLOOR0); mk(P.tel, tel, -MODEL_FLOOR0); mk(P.col, col);
        arm.add(tel); m.add(arm, col);
        group.add(wallG, swing);
        rig = { swing, arm, tel, col, wall: ang };
      } else {
        tube = new THREE.Mesh(tubeGeo, mat); end = new THREE.Mesh(endGeo, mat);
        tube.castShadow = end.castShadow = true;
        group.add(tube, end);
      }
      this.group.add(group);
      const br: Bridge = { group, tube, end, rig, px: best.px, pz: -best.py, base, restYaw, yaw: restYaw, len: this.restLen, floor: FLOOR, connected: false };
      this.pose(br);
      this.bridges.push(br);
      mine.push(br);
      // rotunda at the wall and stand markings (static)
      if (!this.parts) { const rot = tint(new THREE.CylinderGeometry(2.4, 2.4, 3.6, 16), light); rot.translate(best.px, base + FLOOR + 1.2, -best.py); paint.push(rot.toNonIndexed()); }
      // lead-in line and stop bar along the parked aircraft's centreline (nose gear 14.1 m ahead of the datum)
      const [sx, sy] = site.stand;
      const gx0 = sx - best.nx * 14.1, gy0 = sy - best.ny * 14.1;
      for (const [w, d, along] of [[50, 0.45, 25], [0.5, 9, 0]] as const) {
        const g = tint(new THREE.BoxGeometry(w, 0.06, d), yellow);
        g.rotateY(ang);
        g.translate(gx0 + best.nx * along, groundAt(gx0, gy0) + 0.1, -(gy0 + best.ny * along));
        paint.push(g.toNonIndexed());
      }
    }
    let paintMesh: THREE.Mesh | null = null;
    if (paint.length) { paintMesh = new THREE.Mesh(mergeGeometries(paint)!, mat); this.group.add(paintMesh); }
    this.owned.set(id, { bridges: mine, paint: paintMesh, geos: [tubeGeo, endGeo], mat });
  }

  /** Streams an airport's bridges out (its patch was unloaded). */
  removePatch(id: string) {
    this.pending = this.pending.filter((p) => p[0] !== id);
    const o = this.owned.get(id);
    if (!o) return;
    for (const b of o.bridges) { this.group.remove(b.group); if (this.active === b) this.active = null; }
    this.bridges = this.bridges.filter((b) => !o.bridges.includes(b));
    if (o.paint) { this.group.remove(o.paint); o.paint.geometry.dispose(); }
    for (const g of o.geos) g.dispose();
    o.mat.dispose();
    this.owned.delete(id);
  }

  private pose(b: Bridge) {
    if (b.rig) {
      const r = b.rig, ext = b.len - MODEL_LEN0, pitch = Math.atan2(b.floor - FLOOR, b.len);
      r.swing.rotation.y = b.yaw;
      r.arm.position.y = FLOOR; r.arm.rotation.x = -pitch;      // the tunnel pivots at the rotunda end and tilts up or down to the door height
      r.tel.position.z = ext;                                    // the inner tunnel and cab slide out of the main tunnel
      const zc = 14.2 + ext, top = FLOOR - (MODEL_FLOOR0 - 5.0) + zc * Math.tan(pitch);   // underside of the tunnel at the column
      r.col.position.z = ext; r.col.scale.y = Math.max(0.3, top / 4.64);
      return;
    }
    const horizontal = b.len;
    const rise = b.floor - FLOOR;
    const pitch = Math.atan2(rise, horizontal);
    b.group.rotation.y = b.yaw;
    if (!b.tube || !b.end) return;
    const ls = horizontal / Math.cos(pitch);
    b.tube.position.set(0, FLOOR + 1.0, 0);
    b.tube.rotation.z = pitch;
    b.tube.scale.x = ls;
    b.end.position.set(horizontal, FLOOR + 1.0 + rise, 0);
    b.end.rotation.y = 0;
  }

  /** Door centre in three.js world coordinates. */
  private door(ac: Aircraft) {
    return nedToThree(ac.worldPoint(DOOR_BODY));
  }

  private nearest(ac: Aircraft): { b: Bridge; d: number } | null {
    const D = this.door(ac);
    let best: { b: Bridge; d: number } | null = null;
    for (const b of this.bridges) {
      const d = Math.hypot(D.x - b.px, D.z - b.pz);
      if (!best || d < best.d) best = { b, d };
    }
    return best;
  }

  /** A connectable airliner is stopped within range of a bridge. */
  canConnect(ac: Aircraft): boolean {
    if (this.active) return true;
    if (!ac.def.retractableGear || !ac.onGround || Math.hypot(ac.vel.x, ac.vel.y) > 1) return false;
    const n = this.nearest(ac);
    return !!n && n.d < DOOR_RANGE;
  }

  get connected() { return !!this.active?.connected; }

  /** Toggle: connect the nearest bridge to the door, or retract the active one. Returns a status message. */
  toggle(ac: Aircraft): string {
    if (this.active) { this.active.connected = false; this.active = null; return 'Jet bridge retracting'; }
    if (!this.canConnect(ac)) return 'No jet bridge in range: stop an airliner near a gate';
    const n = this.nearest(ac)!;
    n.b.connected = true;
    this.active = n.b;
    return 'Jet bridge connecting';
  }

  /** Horizontal distance from a point to the aircraft's centreline (nose to tail). */
  private clearance(ac: Aircraft, x: number, z: number) {
    const A = nedToThree(ac.worldPoint(new Vec3(18, 0, 0))), B = nedToThree(ac.worldPoint(new Vec3(-22, 0, 0)));
    const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / l2));
    return Math.hypot(x - A.x - dx * t, z - A.z - dz * t);
  }

  update(dt: number, ac: Aircraft) {
    const a = this.active;
    if (a && (Math.hypot(ac.vel.x, ac.vel.y) > 2 || !ac.onGround)) { a.connected = false; this.active = null; }
    for (const b of this.bridges) {
      let tYaw = b.restYaw, tLen = this.restLen, tFloor = FLOOR;
      if (!b.connected && ac.onGround && Math.hypot(ac.pos.y - b.px, -ac.pos.x - b.pz) < 70) {
        // keep stowed bridges clear of a parked aircraft's fuselage/tail
        const cx = b.px + Math.cos(b.restYaw) * this.restLen, cz = b.pz - Math.sin(b.restYaw) * this.restLen;
        const c = this.clearance(ac, cx, cz);
        if (c < 5) tLen = Math.max(this.minLen, this.restLen - (5 - c) * 3);
      }
      if (b.connected) {
        const D = this.door(ac);
        const dx = D.x - b.px, dz = D.z - b.pz;
        tYaw = Math.atan2(-dz, dx);
        tLen = Math.max(this.minLen, Math.min(this.maxLen, Math.hypot(dx, dz) - 2.2));
        tFloor = Math.max(2.4, D.y - b.base - (DOOR_SILL_ABOVE_GROUND > 0 ? 0.9 : 0));
      }
      if (b.yaw === tYaw && b.len === tLen && b.floor === tFloor) continue;
      b.yaw = b.yaw + toward(0, wrap(tYaw - b.yaw), 0.3 * dt);
      b.len = toward(b.len, tLen, 2.5 * dt);
      b.floor = toward(b.floor, tFloor, 0.35 * dt);
      this.pose(b);
    }
  }
}
