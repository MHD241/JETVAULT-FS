// Two-seat training glider, ASK 21 class (not a licensed model of any real aircraft).
//
// Public type data used: span 17.0 m, wing area 17.95 m^2 (aspect ratio ~16), empty mass
// ~360 kg, max mass 600 kg, best glide ~34:1, minimum sink ~0.6 m/s, stall ~65 km/h,
// Vne 280 km/h. ESTIMATES (marked): section drag/lift, airbrake effect, inertia, tail
// geometry, gear spring rates. They are tuned so the simulated polar matches the public
// figures above (tests/glider.test.ts).
//
// Body frame (FRD), metres, origin = reference datum at the typical loaded CG.

import { Vec3, Inertia, DEG } from '../../core/math';
import { AircraftDef, AeroSurfaceDef } from '../fdm/aircraft';
import { AirfoilParams, ControlParams } from '../fdm/aero';
import { C172 } from './c172';

// Laminar-flow glider section (Wortmann-like): low drag over a wide range, clMax ~1.35.
const WING_AF: AirfoilParams = { a0: 5.9, alpha0: -2.4 * DEG, clMax: 1.2, clMin: -1.0, cd0: 0.0041, cdK: 0.0028, cm0: -0.05 };
const TAIL: AirfoilParams = { a0: 5.6, alpha0: 0, clMax: 1.0, clMin: -1.0, cd0: 0.008, cdK: 0.006, cm0: 0 };
const AILERON: ControlParams = { effectiveness: 0.38, dClMaxPerRad: 0.3, cdPerRad2: 0.12, cmPerRad: -0.3 };
const NOFLAP: ControlParams = { effectiveness: 0, dClMaxPerRad: 0, cdPerRad2: 0, cmPerRad: 0 };
const ELEVATOR: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.6, cdPerRad2: 0.1, cmPerRad: -0.4 };
const RUDDER: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.6, cdPerRad2: 0.1, cmPerRad: -0.4 };

export const GLIDER_SPAN = 17.0;
export const GLIDER_AREA = 17.95;
const AR = (GLIDER_SPAN * GLIDER_SPAN) / GLIDER_AREA;
const DIHEDRAL = 3.0 * DEG;
const WING_Z = -0.32; // mid/high wing, above the datum
const WING_X = 0.3; // quarter-chord, ahead of the CG (static margin)
export const gliderChordAt = (y: number) => 1.4 - (y / 8.5) * 0.7; // 1.4 m root -> 0.7 m tip

function wingStrips(): AeroSurfaceDef[] {
  // [y0, y1, kind]: inner panels carry the airbrakes, the outer 55 % the ailerons
  const stations: [number, number, 'brake' | 'plain' | 'aileron'][] = [
    [0.35, 1.6, 'plain'], [1.6, 3.2, 'brake'], [3.2, 4.8, 'plain'], [4.8, 6.4, 'aileron'], [6.4, 7.6, 'aileron'], [7.6, 8.5, 'aileron'],
  ];
  let exposed = 0;
  for (const [a, b] of stations) exposed += ((gliderChordAt(a) + gliderChordAt(b)) / 2) * (b - a);
  const scale = GLIDER_AREA / (2 * exposed);
  const out: AeroSurfaceDef[] = [];
  for (const side of [-1, 1]) {
    stations.forEach(([a, b, kind], i) => {
      const y = (a + b) / 2;
      const chord = (gliderChordAt(a) + gliderChordAt(b)) / 2;
      const area = chord * (b - a) * scale;
      const incidence = (2.2 - 2.5 * (y / 8.5)) * DEG; // washout
      const isLeft = side < 0;
      out.push({
        name: `wing${isLeft ? 'L' : 'R'}${i + 1}`,
        pos: new Vec3(WING_X, side * y, WING_Z - y * Math.tan(DIHEDRAL)),
        area, chord,
        normal: new Vec3(0, -side * Math.sin(DIHEDRAL), -Math.cos(DIHEDRAL)),
        incidence, aspectRatio: AR, oswald: 0.92, span: GLIDER_SPAN,
        airfoil: WING_AF,
        control: kind === 'aileron' ? AILERON : NOFLAP,
        channel: kind === 'aileron' ? (isLeft ? 'aileronL' : 'aileronR') : 'flap',
        slipstream: 0, downwash: false, role: 'wing',
        spoiler: kind === 'brake', spoilerCd: 0.25,
      });
    });
  }
  return out;
}

const HT_SPAN = 3.1, HT_AREA = 2.3;
const surfaces: AeroSurfaceDef[] = [
  ...wingStrips(),
  ...[-1, 1].map((side): AeroSurfaceDef => ({
    name: side < 0 ? 'htailL' : 'htailR',
    pos: new Vec3(-4.75, side * 0.8, -1.25),
    area: HT_AREA / 2, chord: 0.74,
    normal: new Vec3(0, 0, -1), incidence: -0.6 * DEG,
    aspectRatio: (HT_SPAN * HT_SPAN) / HT_AREA, oswald: 0.8, span: HT_SPAN,
    airfoil: TAIL, control: ELEVATOR, channel: 'elevator',
    slipstream: 0, downwash: true, role: 'htail',
  })),
  {
    name: 'fin', pos: new Vec3(-4.85, 0, -0.75),
    area: 1.6, chord: 1.2,
    normal: new Vec3(0, 1, 0), incidence: 0,
    aspectRatio: 1.7, oswald: 0.7, span: 1.6,
    airfoil: TAIL, control: RUDDER, channel: 'rudder',
    slipstream: 0, downwash: false, role: 'vtail',
  },
];

export const GLIDER: AircraftDef = {
  id: 'glider',
  name: 'Training glider (ASK 21 class)',
  glider: true,
  hook: new Vec3(1.55, 0, 0.35),
  emptyMass: 360,
  emptyCG: new Vec3(0, 0, 0.05),
  refInertia: new Inertia(2500, 1000, 3300, 0), // ESTIMATE
  refMass: 450,
  maxTakeoffMass: 600,
  stations: [
    { name: 'Front pilot', pos: new Vec3(0.55, 0, 0.0), mass: 85, max: 110 },
    { name: 'Rear seat', pos: new Vec3(-0.45, 0, 0.0), mass: 0, max: 110 },
  ],
  tanks: [ // no fuel; zero-capacity placeholders keep the shared systems code uniform
    { name: 'None', pos: new Vec3(0, 0, 0), capacity: 0, unusable: 0, side: 'LEFT' },
    { name: 'None', pos: new Vec3(0, 0, 0), capacity: 0, unusable: 0, side: 'RIGHT' },
  ],
  wingArea: GLIDER_AREA,
  wingSpan: GLIDER_SPAN,
  mac: 1.07,
  surfaces,
  controls: {
    elevatorUp: 25 * DEG, elevatorDown: 22 * DEG,
    aileronUp: 28 * DEG, aileronDown: 18 * DEG,
    rudder: 25 * DEG,
    trimRange: 10 * DEG,
    aileronRig: 0,
    flapDetents: [0],
    flapRate: 3.5 * DEG,
    surfaceTau: 0.05,
  },
  fuselage: { pos: new Vec3(0.2, 0, 0), dragArea: 0.045, sideArea: 3.2, planArea: 2.4, munkVolume: 1.0, munkVolumeYaw: 1.2 },
  // inert placeholders (propulsion is skipped for gliders)
  engine: C172.engine, prop: C172.prop, propPos: C172.propPos,
  tailArm: 4.7,
  stallWarnAlpha: 11,
  eye: new Vec3(0.8, 0, -0.42),
  gear: [
    { name: 'Nose skid', attach: new Vec3(2.0, 0, 0.33), length: 0.22, travel: 0.08, spring: 20000, damping: 2000, dampingRebound: 3000, wheelRadius: 0.05, steerMax: 0, brake: null, maxSinkRate: 12.7 },
    { name: 'Main wheel', attach: new Vec3(0.15, 0, 0.30), length: 0.25, travel: 0.1, spring: 45000, damping: 3500, dampingRebound: 5000, wheelRadius: 0.17, steerMax: 0, brake: 'left', maxSinkRate: 12.7 },
    { name: 'Tail wheel', attach: new Vec3(-4.6, 0, 0.17), length: 0.13, travel: 0.06, spring: 15000, damping: 1500, dampingRebound: 2000, wheelRadius: 0.06, steerMax: 0, brake: null, maxSinkRate: 12.7 },
  ],
  contacts: [
    { name: 'Belly', pos: new Vec3(0.6, 0, 0.5), kind: 'structure', crashSpeed: 2.0 },
    { name: 'Nose', pos: new Vec3(2.1, 0, 0.1), kind: 'structure', crashSpeed: 2.0 },
    { name: 'Canopy', pos: new Vec3(0.9, 0, -0.62), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Left wingtip', pos: new Vec3(0.3, -8.5, -0.77), kind: 'structure', crashSpeed: 2.5 },
    { name: 'Right wingtip', pos: new Vec3(0.3, 8.5, -0.77), kind: 'structure', crashSpeed: 2.5 },
    { name: 'Tailplane left', pos: new Vec3(-4.8, -1.55, -1.25), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Tailplane right', pos: new Vec3(-4.8, 1.55, -1.25), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Fin top', pos: new Vec3(-4.85, 0, -1.4), kind: 'structure', crashSpeed: 1.0 },
  ],
  hullPoints: [
    new Vec3(2.1, 0, 0.1), new Vec3(0.3, -8.5, -0.77), new Vec3(0.3, 8.5, -0.77), new Vec3(-4.8, -1.55, -1.25),
    new Vec3(-4.8, 1.55, -1.25), new Vec3(-5.1, 0, -0.3), new Vec3(0.9, 0, -0.62),
  ],
  limits: { vne: 151, vno: 100, vfe: 85, vs0: 35, vs1: 38, nMax: 5.3, nMin: -2.65 },
  spawnHeight: 0.55,
  profile: {
    takeoffTrim: 0.0, takeoffFlapLever: 0,
    approachKias: 55, approachThrottle: 0, approachFlapLever: 0, approachTrim: 0.0, approachPitchDeg: -2,
    cruiseKias: 60, cruiseThrottle: 0, idleRpm: 0, approachRpm: 0, cruiseRpm: 0,
    standClearance: 10,
  },
};
