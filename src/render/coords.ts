import * as THREE from 'three';
import { Vec3, Quat } from '../core/math';

// Physics world is NED (x north, y east, z down). three.js world here is
// x = east, y = up, z = south (right-handed, y-up).

export function nedToThree(v: Vec3, out = new THREE.Vector3()) {
  return out.set(v.y, -v.z, -v.x);
}

/** east/north/up -> three */
export function enuToThree(e: number, n: number, u: number, out = new THREE.Vector3()) {
  return out.set(e, u, -n);
}

/**
 * Rotation matrix taking body-frame (FRD) model coordinates into three.js world.
 * Models are authored directly in FRD (x forward, y right, z down).
 */
export function bodyMatrix(q: Quat, out = new THREE.Matrix4()) {
  const f = nedToThree(q.rotate(new Vec3(1, 0, 0)));
  const r = nedToThree(q.rotate(new Vec3(0, 1, 0)));
  const d = nedToThree(q.rotate(new Vec3(0, 0, 1)));
  return out.makeBasis(f, r, d);
}
