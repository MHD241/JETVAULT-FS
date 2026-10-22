// Passenger boarding bridges at the OSM gate positions (visual only, no collision).
// Each bridge rests swung ~28 degrees off the wall normal and can be driven to a parked
// airliner's forward-left door (connect) and back. Lengths and door position are estimates.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Building, pointInPoly } from '../world/obstacles';
import { Aircraft } from '../sim/fdm/aircraft';
import { Vec3 } from '../core/math';
import { nedToThree } from './coords';

const REST_LEN = 23; // m, pivot to cab centre when stowed
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

interface Bridge {
  group: THREE.Group; tube: THREE.Mesh; end: THREE.Mesh;
  px: number; pz: number; base: number; restYaw: number;
  yaw: number; len: number; floor: number;
  connected: boolean;
}

export class JetBridges {
  readonly group = new THREE.Group();
  private bridges: Bridge[] = [];
  private active: Bridge | null = null;

  constructor(gates: [number, number][], buildings: Building[], groundAt: (e: number, n: number) => number) {
    this.group.name = 'jet bridges';
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
    const terms = buildings.filter((b) => b.role === 'terminal' || b.role === 'pier');
    const used: [number, number][] = [];
    for (const [gx, gy] of gates) {
      if (used.some(([x, y]) => Math.hypot(x - gx, y - gy) < 9)) continue;
      let best = { d: Infinity, px: 0, py: 0, nx: 0, ny: 0 };
      for (const b of terms) {
        const n = b.pts.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = b.pts[2 * i], ay = b.pts[2 * i + 1], bx = b.pts[2 * j], by = b.pts[2 * j + 1];
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          if (l2 < 1) continue;
          const t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / l2));
          const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(gx - px, gy - py);
          if (d < best.d) {
            const L = Math.sqrt(l2);
            let nx = dy / L, ny = -dx / L;
            if (pointInPoly(b.pts, px + nx * 0.5, py + ny * 0.5)) { nx = -nx; ny = -ny; }
            best = { d, px, py, nx, ny };
          }
        }
      }
      if (best.d > 40) continue;
      used.push([gx, gy]);
      const base = groundAt(best.px, best.py);
      const ang = Math.atan2(best.ny, best.nx);
      const restYaw = ang + REST_SWING;
      const group = new THREE.Group();
      group.position.set(best.px, base, -best.py);
      const tube = new THREE.Mesh(tubeGeo, mat);
      const end = new THREE.Mesh(endGeo, mat);
      tube.castShadow = end.castShadow = true;
      group.add(tube, end);
      this.group.add(group);
      const br: Bridge = { group, tube, end, px: best.px, pz: -best.py, base, restYaw, yaw: restYaw, len: REST_LEN, floor: FLOOR, connected: false };
      this.pose(br);
      this.bridges.push(br);
      // rotunda at the wall and stand markings (static)
      const rot = tint(new THREE.CylinderGeometry(2.4, 2.4, 3.6, 16), light);
      rot.translate(best.px, base + FLOOR + 1.2, -best.py);
      paint.push(rot.toNonIndexed());
      for (const [w, h, d, along] of [[50, 0.06, 0.45, 33], [0.5, 0.06, 9, 57]] as const) {
        const g = tint(new THREE.BoxGeometry(w, h, d), yellow);
        g.rotateY(ang); // lead-in follows the wall normal (aircraft park square to the pier)
        g.translate(best.px + best.nx * along, base + 0.1, -(best.py + best.ny * along));
        paint.push(g.toNonIndexed());
      }
    }
    if (paint.length) this.group.add(new THREE.Mesh(mergeGeometries(paint)!, mat));
  }

  private pose(b: Bridge) {
    const horizontal = b.len;
    const rise = b.floor - FLOOR;
    const pitch = Math.atan2(rise, horizontal);
    b.group.rotation.y = b.yaw;
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
      let tYaw = b.restYaw, tLen = REST_LEN, tFloor = FLOOR;
      if (!b.connected && ac.onGround && Math.hypot(ac.pos.y - b.px, -ac.pos.x - b.pz) < 70) {
        // keep stowed bridges clear of a parked aircraft's fuselage/tail
        const cx = b.px + Math.cos(b.restYaw) * REST_LEN, cz = b.pz - Math.sin(b.restYaw) * REST_LEN;
        const c = this.clearance(ac, cx, cz);
        if (c < 11) tLen = Math.max(5, REST_LEN - (11 - c) * 1.6);
      }
      if (b.connected) {
        const D = this.door(ac);
        const dx = D.x - b.px, dz = D.z - b.pz;
        tYaw = Math.atan2(-dz, dx);
        tLen = Math.max(6, Math.hypot(dx, dz) - 2.2);
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
