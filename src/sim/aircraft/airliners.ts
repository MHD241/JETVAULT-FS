// More airliners, derived from the Boeing 737-800 definition by scaling it: lengths by k, areas by k^2, masses, fuel, gear springs and thrust set from
// public type data. ESTIMATES: the section aerodynamics, flap and control behaviour are the 737's, scaled; they are tuned only to fly plausibly
// (see tests/airliners.test.ts), not to match the real aircraft's handling.
import { Vec3, Inertia } from '../../core/math';
import { AircraftDef } from '../fdm/aircraft';
import { B738 } from './b738';

const sv = (v: Vec3, k: number) => new Vec3(v.x * k, v.y * k, v.z * k);

interface Spec {
  id: string; name: string; k: number; emptyMass: number; mtom: number; refMass: number; payload: number; payloadMax: number; fuelLitres: number; fuelUnusable?: number;
  engines: { pos: Vec3; thrust: number }[]; hull: { halfLength: number; radius: number }; spawnHeight: number; eye: Vec3; doorBody: Vec3;
  limits: { vne: number; vno: number; vfe: number; vs0: number; vs1: number }; flapLimitKt: number[]; approachKias: number; cruiseKias: number; standClearance: number;
  gear?: { nose?: Partial<{ x: number }>; mainX?: number; track?: number; wheelRadius?: [number, number] };
}

function scaleJet(s: Spec): AircraftDef {
  const b = B738, k = s.k, massR = s.refMass / b.refMass, ink = massR * k * k, fuelEach = s.fuelLitres / 2;
  const eng = b.turbofans![0];
  return {
    ...b,
    id: s.id, name: s.name,
    emptyMass: s.emptyMass, emptyCG: sv(b.emptyCG, k),
    refInertia: new Inertia(b.refInertia.ixx * ink, b.refInertia.iyy * ink, b.refInertia.izz * ink, 0), refMass: s.refMass, maxTakeoffMass: s.mtom,
    stations: [{ name: 'Passengers and cargo', pos: sv(b.stations[0].pos, k), mass: s.payload, max: s.payloadMax }],
    tanks: b.tanks.map((t) => ({ ...t, pos: sv(t.pos, k), capacity: fuelEach, unusable: (s.fuelUnusable ?? 50) })),
    wingArea: b.wingArea * k * k, wingSpan: b.wingSpan * k, mac: b.mac * k,
    surfaces: b.surfaces.map((f) => ({ ...f, pos: sv(f.pos, k), area: f.area * k * k, chord: f.chord * k, span: f.span * k })),
    fuselage: { pos: sv(b.fuselage.pos, k), dragArea: b.fuselage.dragArea * k * k, sideArea: b.fuselage.sideArea * k * k, planArea: b.fuselage.planArea * k * k, munkVolume: b.fuselage.munkVolume * k ** 3, munkVolumeYaw: b.fuselage.munkVolumeYaw * k ** 3 },
    turbofans: s.engines.map((e) => ({ def: { ...eng.def, ratedThrust: e.thrust, idleFuelFlow: eng.def.idleFuelFlow * (e.thrust / eng.def.ratedThrust) }, pos: e.pos })),
    retractableGear: { time: 9, dragArea: b.retractableGear!.dragArea * k * k },
    gear: b.gear.map((g) => ({ ...g, attach: sv(g.attach, k), length: g.length * k, travel: g.travel * k, spring: g.spring * massR, damping: g.damping * massR, dampingRebound: g.dampingRebound * massR, wheelRadius: g.wheelRadius * k ** 0.8 })),
    contacts: b.contacts.map((c) => ({ ...c, pos: sv(c.pos, k) })),
    hullPoints: b.hullPoints.map((p) => sv(p, k)),
    hull: { x0: -s.hull.halfLength, x1: s.hull.halfLength, radius: s.hull.radius },
    limits: { ...b.limits, ...s.limits },
    spawnHeight: s.spawnHeight, tailArm: b.tailArm * k, eye: s.eye,
    profile: {
      ...b.profile, takeoffTrim: 0, fixedTrim: 0, trimModel: undefined, flapLimitKt: s.flapLimitKt, approachKias: s.approachKias, cruiseKias: s.cruiseKias,
      standClearance: s.standClearance, doorBody: s.doorBody, approachTrim: 0, approachThrottle: 0.5,
    },
  };
}

/** Airbus A320-200 (CFM56-5B4, 2 x about 120 kN; span 34.1 m, length 37.57 m, wing area 122.6 m^2, MTOW 78 t, OEW about 42.6 t). Close to the 737-800 in size, so k is about 1. */
export const A320: AircraftDef = scaleJet({
  id: 'a320', name: 'Airbus A320-200', k: 0.994, emptyMass: 42600, mtom: 78000, refMass: 62000, payload: 11000, payloadMax: 19000, fuelLitres: 24210,
  engines: [{ pos: new Vec3(5.9, -5.0, 2.2), thrust: 165000 }, { pos: new Vec3(5.9, 5.0, 2.2), thrust: 165000 }],
  hull: { halfLength: 18.5, radius: 1.98 }, spawnHeight: 3.8, eye: new Vec3(15.4, -0.45, -1.5), doorBody: new Vec3(11.6, -1.98, 0),
  limits: { vne: 350, vno: 350, vfe: 177, vs0: 108, vs1: 132 }, flapLimitKt: [999, 230, 215, 200, 190, 185, 180, 177, 177], approachKias: 138, cruiseKias: 250, standClearance: 20,
});

/** Airbus A340-600 (4 x Trent 556, about 249 kN; span 63.45 m, length 75.36 m, wing area 437 m^2, MTOW 380 t, OEW about 177 t). */
export const A340: AircraftDef = scaleJet({
  id: 'a340', name: 'Airbus A340-600', k: 1.849, emptyMass: 177000, mtom: 380000, refMass: 285000, payload: 40000, payloadMax: 70000, fuelLitres: 195600, fuelUnusable: 300,
  engines: [-22.2, -12.0, 12.0, 22.2].map((y) => ({ pos: new Vec3(Math.abs(y) > 15 ? 9.5 : 11.5, y, 3.4), thrust: 235000 })),
  hull: { halfLength: 37.7, radius: 2.8 }, spawnHeight: 6.9, eye: new Vec3(31.5, -0.7, -1.3), doorBody: new Vec3(27.9, -2.8, 0),
  limits: { vne: 330, vno: 330, vfe: 195, vs0: 118, vs1: 142 }, flapLimitKt: [999, 250, 235, 220, 205, 195, 190, 185, 180], approachKias: 148, cruiseKias: 280, standClearance: 40,
});

/** Airbus A350-1000 (2 x Trent XWB-97, about 431 kN; span 64.75 m, length 73.8 m, wing area 442 m^2, MTOW 322 t, OEW about 155 t). */
export const A350: AircraftDef = scaleJet({
  id: 'a350', name: 'Airbus A350-1000', k: 1.887, emptyMass: 155000, mtom: 322000, refMass: 245000, payload: 40000, payloadMax: 75000, fuelLitres: 158000, fuelUnusable: 300,
  engines: [{ pos: new Vec3(11.5, -10.4, 3.3), thrust: 390000 }, { pos: new Vec3(11.5, 10.4, 3.3), thrust: 390000 }],
  hull: { halfLength: 36.9, radius: 2.98 }, spawnHeight: 7.2, eye: new Vec3(29.4, -0.7, -1.4), doorBody: new Vec3(28.4, -2.98, 0),
  limits: { vne: 340, vno: 340, vfe: 190, vs0: 112, vs1: 138 }, flapLimitKt: [999, 250, 235, 220, 205, 195, 190, 185, 180], approachKias: 140, cruiseKias: 285, standClearance: 40,
});
