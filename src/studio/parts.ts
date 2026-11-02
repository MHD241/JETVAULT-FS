// Shared by the cockpit studio and the game: the part list format and how a part becomes a three.js mesh.
// Studio frame: X forward, Y up, Z to the pilot's right, metres, origin on the floor at body point (13.5, 0, 0.45).
// Body (FRD) = (13.5 + X, Z, 0.45 - Y).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type PartType = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'capsule' | 'hollowsphere' | 'hollowcapsule' | 'plane' | 'screen' | 'connector';
export type ScreenKind = 'pfd' | 'nd' | 'eng' | 'mcp';

export interface Part {
  id: number; type: PartType; name: string;
  pos: [number, number, number]; rot: [number, number, number]; // rot in degrees
  color: string; rough: number; metal: number; emissive: number;
  /** dimensions by type: box w,h,d,radius,seg | cylinder rt,rb,h,sides,bevel | sphere r | cone r,h,sides | torus R,tube | capsule r,len | plane w,h | screen w,h | connector radius,sides */
  d: Record<string, number>;
  screen?: ScreenKind;
  /** connector ends: ids of two other parts */
  a?: number; b?: number;
}
export interface Design { version: 1; nextId: number; parts: Part[]; /** pilot's eye (the game camera), studio X forward, Y up, Z right */ eye?: [number, number, number] }

export const STUDIO_ORIGIN = { x: 13.5, y: 0, z: 0.45 };
export const EYE_STUDIO = { X: 0.9, Y: 1.13, Z: -0.53 };

export const DEFAULTS: Record<PartType, Record<string, number>> = {
  box: { w: 0.4, h: 0.2, d: 0.3, radius: 0.02, seg: 4 },
  cylinder: { rt: 0.1, rb: 0.1, h: 0.3, sides: 24, bevel: 0.01 },
  sphere: { r: 0.12 },
  cone: { r: 0.12, h: 0.25, sides: 24 },
  torus: { R: 0.15, tube: 0.02 },
  capsule: { r: 0.04, len: 0.2, sx: 1, sz: 1 },
  hollowsphere: { r: 0.15, wall: 0.01, opening: 70 },
  hollowcapsule: { r: 0.05, len: 0.2, wall: 0.006 },
  plane: { w: 0.4, h: 0.3 },
  screen: { w: 0.2, h: 0.2 },
  connector: { radius: 0.02, sides: 12 },
};

function roundedCylinder(rt: number, rb: number, h: number, sides: number, bevel: number) {
  const b = Math.max(0.0005, Math.min(bevel, h / 2 - 0.0005, Math.min(rt, rb) - 0.0005));
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)];
  const arc = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (Math.PI / 2); pts.push(new THREE.Vector2(cx + Math.cos(a) * b, cy + Math.sin(a) * b)); } };
  arc(rb - b, -h / 2 + b, -Math.PI / 2);
  arc(rt - b, h / 2 - b, 0);
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, Math.max(6, Math.round(sides)));
}

export function geometryFor(p: Part): THREE.BufferGeometry {
  const d = p.d;
  switch (p.type) {
    case 'box': return new RoundedBoxGeometry(d.w, d.h, d.d, Math.round(d.seg), Math.max(0.0005, Math.min(d.radius, Math.min(d.w, d.h, d.d) / 2 - 0.0005)));
    case 'cylinder': return d.bevel > 0.0004 ? roundedCylinder(d.rt, d.rb, d.h, d.sides, d.bevel) : new THREE.CylinderGeometry(d.rt, d.rb, d.h, Math.round(d.sides));
    case 'sphere': return new THREE.SphereGeometry(d.r, 32, 20);
    case 'cone': return new THREE.ConeGeometry(d.r, d.h, Math.round(d.sides));
    case 'torus': return new THREE.TorusGeometry(d.R, d.tube, 12, 40);
    case 'capsule': { const g = new THREE.CapsuleGeometry(d.r, d.len, 8, 20); g.scale(d.sx, 1, d.sz); return g; }
    case 'hollowsphere': {
      // a spherical shell with real wall thickness and a round opening (opening = half-angle of the hole, degrees; 0 = closed)
      const R = d.r, t = Math.min(d.wall, R - 0.001), a0 = (Math.max(0, d.opening) * Math.PI) / 180, pts: THREE.Vector2[] = [];
      const n = 28;
      for (let i = 0; i <= n; i++) { const a = a0 + ((Math.PI - a0) * i) / n; pts.push(new THREE.Vector2(Math.sin(a) * R, Math.cos(a) * R)); }
      for (let i = n; i >= 0; i--) { const a = a0 + ((Math.PI - a0) * i) / n; pts.push(new THREE.Vector2(Math.sin(a) * (R - t), Math.cos(a) * (R - t))); }
      pts.push(pts[0].clone());
      const g = new THREE.LatheGeometry(pts, 40); return g;
    }
    case 'hollowcapsule': {
      // a capsule-shaped tube with wall thickness, closed at the bottom and open at the top
      const R = d.r, t = Math.min(d.wall, R - 0.001), h = d.len / 2, pts: THREE.Vector2[] = [], n = 14;
      pts.push(new THREE.Vector2(R, h));
      pts.push(new THREE.Vector2(R, -h));
      for (let i = 1; i <= n; i++) { const a = (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * R, -h - Math.sin(a) * R)); }
      for (let i = n; i >= 1; i--) { const a = (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * (R - t), -h - Math.sin(a) * (R - t))); }
      pts.push(new THREE.Vector2(R - t, -h)); pts.push(new THREE.Vector2(R - t, h)); pts.push(pts[0].clone());
      return new THREE.LatheGeometry(pts, 36);
    }
    case 'plane': case 'screen': return new THREE.PlaneGeometry(d.w, d.h);
    case 'connector': return new THREE.CylinderGeometry(d.radius, d.radius, 1, Math.round(d.sides));
  }
}

export function materialFor(p: Part): THREE.Material {
  if (p.type === 'screen') return new THREE.MeshBasicMaterial({ color: '#0a0b0c', side: THREE.DoubleSide });
  return new THREE.MeshStandardMaterial({ color: p.color, roughness: p.rough, metalness: p.metal, emissive: p.color, emissiveIntensity: p.emissive, side: p.type === 'plane' || p.type === 'hollowsphere' || p.type === 'hollowcapsule' ? THREE.DoubleSide : THREE.FrontSide });
}

/** Fit a unit cylinder between two points (for connectors). */
export function placeConnector(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const len = Math.max(0.001, a.distanceTo(b));
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.scale.set(1, len, 1);
}

export function buildMesh(p: Part, all: Part[]): THREE.Mesh {
  const m = new THREE.Mesh(geometryFor(p), materialFor(p));
  m.userData.partId = p.id;
  if (p.type === 'connector') {
    const A = all.find((x) => x.id === p.a), B = all.find((x) => x.id === p.b);
    if (A && B) placeConnector(m, new THREE.Vector3(...A.pos), new THREE.Vector3(...B.pos)); else m.visible = false;
  } else {
    m.position.set(...p.pos);
    m.rotation.set(p.rot[0] * Math.PI / 180, p.rot[1] * Math.PI / 180, p.rot[2] * Math.PI / 180, 'YXZ');
  }
  return m;
}
