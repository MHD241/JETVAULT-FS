// Landing gear and airframe ground contact.
//
// Each gear leg is a spring-damper along the body z axis with a tyre at its end. The
// tyre contact uses the real terrain height and surface normal under the wheel:
//   - normal force from strut compression (spring + damper, hard stop when bottomed)
//   - rolling resistance from the surface type
//   - braking up to the surface friction limit
//   - lateral force from tyre slip angle at speed, and a "bristle" (stiction) model at
//     low speed so the aircraft can stand still on a slope with brakes set
//   - nosewheel steering linked to the rudder pedals
// Non-gear contact points (wingtips, tail, propeller tip, belly) detect scrapes and
// crashes against the same terrain.

import { Vec3, Quat, clamp, smoothstep, DEG } from '../../core/math';

export interface SurfaceInfo {
  /** Tyre/ground friction coefficient (dry asphalt ~0.8, wet ~0.5, grass ~0.4). */
  friction: number;
  /** Rolling resistance coefficient (asphalt 0.02, grass 0.05-0.1). */
  rolling: number;
  kind: 'asphalt' | 'concrete' | 'grass' | 'water' | 'ground';
}

export interface GroundQuery {
  /** Elevation (m MSL) and up-normal (east, north, up) at local east/north. */
  heightAt(east: number, north: number, normalOut?: { e: number; n: number; u: number }): number;
  surfaceAt(east: number, north: number): SurfaceInfo;
}

export interface GearDef {
  name: string;
  /** Strut attach point (top of travel) in body frame relative to the datum. */
  attach: Vec3;
  /** Distance from attach point to bottom of tyre with the strut fully extended, m. */
  length: number;
  /** Usable strut/tyre travel before bottoming, m. */
  travel: number;
  spring: number; // N/m
  damping: number; // N s/m (compression)
  dampingRebound: number; // N s/m
  wheelRadius: number;
  /** Maximum nosewheel steering angle, rad (0 = not steerable). */
  steerMax: number;
  brake: 'left' | 'right' | null;
  /** Maximum vertical speed the leg tolerates at contact, m/s. */
  maxSinkRate: number;
}

export interface ContactPointDef {
  name: string;
  pos: Vec3;
  /** 'prop' contacts are only fatal while the propeller turns. */
  kind: 'structure' | 'prop' | 'tail';
  /** Vertical impact speed above which contact counts as a crash, m/s. */
  crashSpeed: number;
}

export interface GearState {
  compression: number;
  force: number; // normal force, N
  contact: boolean;
  wheelAngle: number; // rad, for rendering
  wheelSpeed: number; // m/s along heading
  steer: number; // rad
  skidding: boolean;
  bristle: Vec3; // world-frame stiction displacement
  touchdownSink: number; // m/s at the most recent touchdown
  bottomed: boolean;
  surface: SurfaceInfo['kind'] | null;
}

export interface ContactEvent {
  name: string;
  kind: ContactPointDef['kind'] | 'gear' | 'building';
  impactSpeed: number;
  fatal: boolean;
}

export interface GearInputs {
  steer: number; // -1..1 (rudder pedals)
  brakeLeft: number; // 0..1
  brakeRight: number;
  parkingBrake: boolean;
}

export interface BodyKinematics {
  pos: Vec3; // NED of CG
  vel: Vec3; // NED
  q: Quat;
  omega: Vec3; // body
  cg: Vec3; // body offset of CG from datum
}

const BRISTLE_K = 60000;
const BRISTLE_C = 4000;
const MAX_BRAKE_MU = 0.5; // light-aircraft disc brakes are torque-limited below tyre friction

export function newGearState(): GearState {
  return {
    compression: 0, force: 0, contact: false, wheelAngle: 0, wheelSpeed: 0, steer: 0,
    skidding: false, bristle: new Vec3(), touchdownSink: 0, bottomed: false, surface: null,
  };
}

const nTmp = { e: 0, n: 0, u: 1 };

/**
 * Computes gear forces. Returns total force (body frame) and moment about CG (body
 * frame); updates gear states and pushes contact events.
 */
export function gearForces(
  defs: GearDef[], states: GearState[], k: BodyKinematics, ground: GroundQuery, inp: GearInputs,
  dt: number, events: ContactEvent[],
): { force: Vec3; moment: Vec3 } {
  const force = new Vec3();
  const moment = new Vec3();
  const strutAxis = k.q.rotate(new Vec3(0, 0, 1));
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const s = states[i];
    const rAttach = d.attach.sub(k.cg);
    const pAttach = k.pos.add(k.q.rotate(rAttach));
    const pWheel = pAttach.add(strutAxis.scale(d.length));
    const hGround = ground.heightAt(pWheel.y, pWheel.x, nTmp);
    const nW = new Vec3(nTmp.n, nTmp.e, -nTmp.u); // up normal in NED
    // vertical depth below ground (NED z is down), converted to depth along the normal
    const depth = (pWheel.z + hGround) * nTmp.u;
    s.steer = d.steerMax * clamp(inp.steer, -1, 1);
    if (depth <= 0) {
      s.contact = false; s.compression = 0; s.force = 0; s.bristle.set(0, 0, 0); s.skidding = false;
      s.bottomed = false; s.surface = null;
      continue;
    }
    // contact point at the tyre bottom, pushed up to the surface
    const rContact = rAttach.add(new Vec3(0, 0, d.length - Math.min(depth, d.length)));
    const vContact = k.vel.add(k.q.rotate(k.omega.cross(rContact)));
    const approachSpeed = -vContact.dot(nW); // >0 when moving into the ground
    if (!s.contact) {
      s.touchdownSink = approachSpeed;
      if (approachSpeed > d.maxSinkRate) {
        events.push({ name: d.name, kind: 'gear', impactSpeed: approachSpeed, fatal: true });
      }
    }
    s.contact = true;
    const comp = depth;
    s.compression = Math.min(comp, d.travel);
    let fn = d.spring * comp + (approachSpeed > 0 ? d.damping : d.dampingRebound) * approachSpeed;
    s.bottomed = comp > d.travel;
    if (s.bottomed) {
      fn += d.spring * 25 * (comp - d.travel) + d.damping * 4 * Math.max(0, approachSpeed);
    }
    if (fn < 0) fn = 0;
    s.force = fn;

    // Tyre frame on the ground plane
    const surf = ground.surfaceAt(pWheel.y, pWheel.x);
    s.surface = surf.kind;
    const fwdBody = new Vec3(Math.cos(s.steer), Math.sin(s.steer), 0);
    let fwd = k.q.rotate(fwdBody);
    fwd = fwd.sub(nW.scale(fwd.dot(nW))).norm();
    const right = fwd.cross(nW).norm();
    const vT = vContact.sub(nW.scale(vContact.dot(nW)));
    const vLong = vT.dot(fwd);
    const vLat = vT.dot(right);
    s.wheelSpeed = vLong;
    s.wheelAngle += (vLong / d.wheelRadius) * dt;

    const mu = surf.friction;
    const brakeIn = d.brake === 'left' ? inp.brakeLeft : d.brake === 'right' ? inp.brakeRight : 0;
    const brake = Math.max(brakeIn, inp.parkingBrake && d.brake ? 1 : 0);
    const brakeCap = brake * Math.min(mu, MAX_BRAKE_MU) * fn;
    const speed = Math.abs(vLong);

    // High speed model: slip-angle lateral force, kinetic braking
    const slip = Math.atan2(vLat, Math.max(speed, 0.5));
    const fLatDyn = -mu * fn * clamp(slip / (8 * DEG), -1, 1);
    const fLongDyn = -(surf.rolling * fn + brakeCap) * Math.tanh(vLong / 0.3);

    // Low speed bristle model (holds the aircraft still)
    s.bristle.addScaled(vT, dt);
    s.bristle = s.bristle.sub(nW.scale(s.bristle.dot(nW)));
    let bLong = s.bristle.dot(fwd);
    let bLat = s.bristle.dot(right);
    if (brake <= 0.02) bLong = 0; // free rolling: no longitudinal stiction
    let fbLong = -(BRISTLE_K * bLong + BRISTLE_C * (brake > 0.02 ? vLong : 0));
    let fbLat = -(BRISTLE_K * bLat + BRISTLE_C * vLat);
    const capLong = brake > 0.02 ? brakeCap + surf.rolling * fn : surf.rolling * fn;
    if (Math.abs(fbLong) > capLong) {
      fbLong = Math.sign(fbLong) * capLong;
      bLong = -(fbLong + BRISTLE_C * (brake > 0.02 ? vLong : 0)) / BRISTLE_K;
    }
    const capLat = mu * fn;
    if (Math.abs(fbLat) > capLat) {
      fbLat = Math.sign(fbLat) * capLat;
      bLat = -(fbLat + BRISTLE_C * vLat) / BRISTLE_K;
    }
    s.bristle = fwd.scale(bLong).add(right.scale(bLat));
    if (brake <= 0.02) fbLong = -surf.rolling * fn * Math.tanh(vLong / 0.05);

    const w = smoothstep(0.5, 2.5, Math.hypot(vLong, vLat));
    let fLong = fLongDyn * w + fbLong * (1 - w);
    let fLat = fLatDyn * w + fbLat * (1 - w);
    const tot = Math.hypot(fLong, fLat);
    const cap = mu * fn;
    s.skidding = tot > cap * 0.98 && w > 0.5;
    if (tot > cap) { fLong *= cap / tot; fLat *= cap / tot; }

    const fWorld = nW.scale(fn).add(fwd.scale(fLong)).add(right.scale(fLat));
    const fBody = k.q.invRotate(fWorld);
    force.addIn(fBody);
    moment.addIn(rContact.cross(fBody));
  }
  return { force, moment };
}

/**
 * Non-gear airframe contact points. Applies a stiff, frictional reaction so scrapes
 * (e.g. a tail strike) are physical, and reports impacts.
 */
export function contactPointForces(
  defs: ContactPointDef[], active: boolean[], k: BodyKinematics, ground: GroundQuery,
  propTurning: boolean, events: ContactEvent[],
): { force: Vec3; moment: Vec3 } {
  const force = new Vec3();
  const moment = new Vec3();
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const r = d.pos.sub(k.cg);
    const p = k.pos.add(k.q.rotate(r));
    const h = ground.heightAt(p.y, p.x, nTmp);
    const depth = (p.z + h) * nTmp.u;
    if (depth <= 0) { active[i] = false; continue; }
    const nW = new Vec3(nTmp.n, nTmp.e, -nTmp.u);
    const v = k.vel.add(k.q.rotate(k.omega.cross(r)));
    const vn = -v.dot(nW);
    if (!active[i]) {
      const fatal = (d.kind === 'prop' && propTurning) || vn > d.crashSpeed;
      events.push({ name: d.name, kind: d.kind, impactSpeed: vn, fatal });
    }
    active[i] = true;
    if (d.kind === 'prop') continue; // the prop tip itself does not support the aircraft
    const fn = Math.max(0, 300000 * depth + 20000 * vn);
    const vT = v.sub(nW.scale(v.dot(nW)));
    const sp = vT.len();
    const fric = sp > 1e-3 ? vT.scale(-Math.min(0.5 * fn, 30000 * sp) / sp) : new Vec3();
    const fW = nW.scale(fn).add(fric);
    const fB = k.q.invRotate(fW);
    force.addIn(fB);
    moment.addIn(r.cross(fB));
  }
  return { force, moment };
}
