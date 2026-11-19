// The film shot list: each shot sets the aircraft, the place, the time of day and weather, a scripted pilot and a scripted camera.
// The player only presses START and records the screen. (Used by the menu's Director page and Main.directorStart.)
import * as THREE from 'three';
import type { DirectorShot, ShotCtx, ShotCam } from './director';

const v = new THREE.Vector3();
/** Orbit camera around the aircraft: `a0` radians from the nose (positive = right), turning at `rate` rad/s. */
function orbit(a0: number, rate: number, radius: number, height: number, fov: number) {
  return (t: number, c: ShotCtx): ShotCam => {
    const a = a0 + rate * t;
    const pos = c.p.clone().addScaledVector(c.fwd, Math.cos(a) * radius).addScaledVector(c.right, Math.sin(a) * radius);
    pos.y += height;
    return { pos, look: c.p.clone(), fov };
  };
}
/** A fixed camera on the ground that follows the aircraft with its eyes. */
function tripod(forward: number, side: number, height: number, fov: number) {
  return (_t: number, c: ShotCtx): ShotCam => ({ pos: v.copy(c.p0).addScaledVector(c.fwd0, forward).addScaledVector(c.right0, side).setY(c.ground + height).clone(), look: c.p.clone(), fov });
}

export const SHOTS: DirectorShot[] = [
  { id: 'approach', title: 'Golden hour approach (A320)', aircraft: 'a320', kind: 'landing', runway: '24', nm: 4, dayOfYear: 190, timeOfDay: 19.9, cloud: 'SCT', duration: 26, cam: orbit(0.9, 0.05, 75, 12, 45) },
  { id: 'approach-rwy', title: 'Landing from the runway: A320 flies over and lands', aircraft: 'a320', kind: 'landing', runway: '24', nm: 4, dayOfYear: 190, timeOfDay: 19.9, cloud: 'SCT', duration: 30, cam: tripod(1500 - 60, -30, 2.2, 32) },
  { id: 'takeoff', title: 'Takeoff roll (A320)', aircraft: 'a320', kind: 'takeoff', runway: '24', dayOfYear: 190, timeOfDay: 20.2, cloud: 'SCT', duration: 24, cam: tripod(330, -32, 2.5, 38) },
  { id: 'c17', title: 'Heavy lift approach (C-17)', aircraft: 'c17', kind: 'landing', runway: '24', nm: 4, dayOfYear: 190, timeOfDay: 12.6, cloud: 'FEW', duration: 26, cam: orbit(-0.8, -0.04, 100, 8, 42) },
  { id: 'c17-rwy', title: 'Landing from the runway: C-17 flies over and lands', aircraft: 'c17', kind: 'landing', runway: '24', nm: 4, dayOfYear: 190, timeOfDay: 12.6, cloud: 'FEW', duration: 30, cam: tripod(1500 - 60, 35, 2.5, 30) },
  { id: 'dusk', title: 'Dusk approach from the cockpit (A320)', aircraft: 'a320', kind: 'landing', runway: '24', nm: 4, dayOfYear: 322, timeOfDay: 17.0, cloud: 'FEW', duration: 36, view: 'cockpit' },
  { id: 'city', title: 'Over the city (A320)', aircraft: 'a320', kind: 'cruise', runway: '24', dayOfYear: 300, timeOfDay: 14.6, cloud: 'FEW', duration: 16, cruiseAglFt: 1800, spawn: { kind: 'air', east: 3000, north: 300, altFt: 1900, hdg: Math.PI / 2 }, cam: orbit(0.6, -0.03, 95, 14, 45) },
];
