// Cessna 172S Skyhawk SP - aircraft definition.
//
// Geometry, mass and performance targets come from public sources:
//   - C172S Pilot's Operating Handbook (dimensions, weights, V-speeds, performance tables)
//   - Roskam, "Airplane Flight Dynamics and Automatic Flight Controls" Part I, App. B
//     (Cessna 172 inertia data)
//   - Lycoming IO-360-L2A: 180 hp at 2700 rpm, 361 in^3
// Aerodynamic section data are representative of NACA 2412 (wing) and NACA 0009-like
// (tail) sections. Final values are tuned so that the simulated aircraft meets the POH
// numbers checked in tests/c172.performance.test.ts.
//
// Body frame (FRD), metres, origin = reference datum close to the typical loaded CG.

import { Vec3, Inertia, DEG } from '../../core/math';
import { AircraftDef, AeroSurfaceDef } from '../fdm/aircraft';
import { AirfoilParams, ControlParams } from '../fdm/aero';

const NACA2412: AirfoilParams = { a0: 5.7, alpha0: -2.1 * DEG, clMax: 1.6, clMin: -1.25, cd0: 0.0072, cdK: 0.0055, cm0: -0.045 };
const TAIL: AirfoilParams = { a0: 5.8, alpha0: 0, clMax: 1.05, clMin: -1.05, cd0: 0.008, cdK: 0.006, cm0: 0 };
const FIN: AirfoilParams = { a0: 5.8, alpha0: 0, clMax: 1.0, clMin: -1.0, cd0: 0.008, cdK: 0.006, cm0: 0 };

const FLAP: ControlParams = { effectiveness: 0.38, dClMaxPerRad: 1.6, cdPerRad2: 0.36, cmPerRad: -0.25 };
const AILERON: ControlParams = { effectiveness: 0.32, dClMaxPerRad: 0.3, cdPerRad2: 0.15, cmPerRad: -0.3 };
const ELEVATOR: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.6, cdPerRad2: 0.1, cmPerRad: -0.4 };
const RUDDER: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.6, cdPerRad2: 0.1, cmPerRad: -0.4 };

const WING_SPAN = 11.0;
const WING_AREA = 16.2;
const WING_AR = (WING_SPAN * WING_SPAN) / WING_AREA;
// Geometric dihedral is 1.73 deg; the high-wing/fuselage interference adds roughly the
// rolling moment due to sideslip of another ~2 deg (DATCOM wing-body term). Tuned so the
// extracted Clb matches Roskam's C172 value (tools/probe/derivs.ts).
const DIHEDRAL = 3.8 * DEG; // aerodynamic (normal tilt)
const GEOM_DIHEDRAL = 1.73 * DEG; // geometric (strip positions)
const WING_Z = -1.0; // wing root quarter chord height above datum (high wing)
const WING_X = 0.06; // quarter-chord line

/** Wing chord at spanwise station y (rectangular inboard, tapered outboard). */
function chordAt(y: number) {
  return y <= 2.6 ? 1.63 : 1.63 - ((y - 2.6) / (5.5 - 2.6)) * 0.5;
}

function wingStrips(): AeroSurfaceDef[] {
  const stations: [number, number, 'flap' | 'aileron'][] = [
    [0.55, 1.75, 'flap'], [1.75, 2.95, 'flap'], [2.95, 4.2, 'aileron'], [4.2, 5.5, 'aileron'],
  ];
  // Integrate exposed area, then scale so the strips carry the full reference area
  // (the fuselage carry-through lift is distributed over the strips).
  let exposed = 0;
  for (const [a, b] of stations) exposed += ((chordAt(a) + chordAt(b)) / 2) * (b - a);
  const scale = WING_AREA / (2 * exposed);
  const out: AeroSurfaceDef[] = [];
  for (const side of [-1, 1]) {
    stations.forEach(([a, b, kind], i) => {
      const y = (a + b) / 2;
      const chord = (chordAt(a) + chordAt(b)) / 2;
      const area = chord * (b - a) * scale;
      // 3 deg linear washout (geometric +1.5 root / -1.5 tip). Strip theory omits the
      // fuselage upwash and carry-through lift, so the effective incidence is raised by
      // 1.3 deg to reproduce the C172's measured CL0 of ~0.3 (Roskam).
      const incidence = (2.8 - 3.0 * (y / 5.5)) * DEG;
      const isLeft = side < 0;
      out.push({
        name: `wing${isLeft ? 'L' : 'R'}${i + 1}`,
        pos: new Vec3(WING_X, side * y, WING_Z - y * Math.tan(GEOM_DIHEDRAL)),
        area, chord,
        normal: new Vec3(0, -side * Math.sin(DIHEDRAL), -Math.cos(DIHEDRAL)),
        incidence, aspectRatio: WING_AR, oswald: 0.78, span: WING_SPAN,
        airfoil: NACA2412,
        control: kind === 'flap' ? FLAP : AILERON,
        channel: kind === 'flap' ? 'flap' : isLeft ? 'aileronL' : 'aileronR',
        slipstream: i === 0 ? 0.45 : 0,
        downwash: false,
        role: 'wing',
      });
    });
  }
  return out;
}

const HT_SPAN = 3.45;
const HT_AREA = 3.4;
const HT_INCIDENCE = 0.4 * DEG;

const surfaces: AeroSurfaceDef[] = [
  ...wingStrips(),
  ...[-1, 1].map((side): AeroSurfaceDef => ({
    name: side < 0 ? 'htailL' : 'htailR',
    pos: new Vec3(-4.62, side * 0.86, -0.2),
    area: HT_AREA / 2, chord: 1.0,
    normal: new Vec3(0, 0, -1), incidence: HT_INCIDENCE,
    aspectRatio: (HT_SPAN * HT_SPAN) / HT_AREA, oswald: 0.75, span: HT_SPAN,
    airfoil: TAIL, control: ELEVATOR, channel: 'elevator',
    slipstream: 0.3, downwash: true, role: 'htail', // contracted slipstream covers ~35 % of the tail span
  })),
  {
    name: 'fin',
    pos: new Vec3(-4.95, 0, -0.85),
    area: 1.7, chord: 1.13,
    normal: new Vec3(0, 1, 0), incidence: 0,
    aspectRatio: 2.0, oswald: 0.7, span: 1.5,
    airfoil: FIN, control: RUDDER, channel: 'rudder',
    slipstream: 0.5, downwash: false, role: 'vtail', // lower half of the fin
  },
];

export const C172: AircraftDef = {
  id: 'c172s',
  name: 'Cessna 172S Skyhawk SP',
  emptyMass: 754, // 1663 lb basic empty weight
  emptyCG: new Vec3(-0.03, 0, 0.1),
  refInertia: new Inertia(1285, 1825, 2667, 0),
  refMass: 1043,
  maxTakeoffMass: 1157, // 2550 lb
  stations: [
    { name: 'Pilot', pos: new Vec3(0.12, -0.3, 0.1), mass: 85, max: 136 },
    { name: 'Front passenger', pos: new Vec3(0.12, 0.3, 0.1), mass: 0, max: 136 },
    { name: 'Rear passengers', pos: new Vec3(-0.78, 0, 0.05), mass: 0, max: 200 },
    { name: 'Baggage', pos: new Vec3(-1.5, 0, 0.1), mass: 10, max: 54 },
  ],
  tanks: [
    // 28 US gal per side (26.5 usable), avgas 0.72 kg/L
    { name: 'Left', pos: new Vec3(-0.05, -1.8, -1.0), capacity: 76.3, unusable: 4.1, side: 'LEFT' },
    { name: 'Right', pos: new Vec3(-0.05, 1.8, -1.0), capacity: 76.3, unusable: 4.1, side: 'RIGHT' },
  ],
  wingArea: WING_AREA,
  wingSpan: WING_SPAN,
  mac: 1.49,
  surfaces,
  controls: {
    elevatorUp: 28 * DEG, elevatorDown: 23 * DEG,
    aileronUp: 20 * DEG, aileronDown: 15 * DEG,
    rudder: 17 * DEG,
    trimRange: 12 * DEG,
    aileronRig: 0.0165, // balances propeller torque at cruise power
    flapDetents: [0, 10 * DEG, 20 * DEG, 30 * DEG],
    flapRate: 3.5 * DEG,
    surfaceTau: 0.06,
  },
  fuselage: { pos: new Vec3(0.2, 0, -0.1), dragArea: 0.27, sideArea: 5.5, planArea: 4.0, munkVolume: 5.0, munkVolumeYaw: 4.8 },
  engine: {
    displacement: 361 * 1.6387e-5,
    ratedPower: 180 * 745.7,
    ratedRpm: 2700,
    maxRpm: 2700,
    idleRpm: 650,
    inertia: 1.9,
    starterTorque: 120,
    starterMaxRpm: 320,
    fullRichFAR: 0.088,
  },
  prop: {
    diameter: 1.93, // 76 in fixed pitch
    J: [0.0, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5],
    // Fixed-pitch climb/cruise propeller; efficiency J*CT/CP peaks at ~0.83 near J = 0.9
    CT: [0.092, 0.0895, 0.083, 0.066, 0.0529, 0.0446, 0.0346, 0.0232, 0.0115, 0.00125, -0.012, -0.04],
    CP: [0.059, 0.058, 0.0565, 0.0515, 0.0475, 0.0435, 0.0375, 0.029, 0.018, 0.005, -0.01, -0.045],
  },
  propPos: new Vec3(2.25, 0, -0.25),
  propInertia: 1.3,
  swirl: 0.06,
  gear: [
    {
      name: 'Nose', attach: new Vec3(1.2, 0, 0.25), length: 0.75, travel: 0.18,
      spring: 35000, damping: 3500, dampingRebound: 5000, wheelRadius: 0.19,
      steerMax: 10 * DEG, brake: null, maxSinkRate: 12.7,
    },
    {
      name: 'Left main', attach: new Vec3(-0.45, -1.27, 0.35), length: 0.65, travel: 0.15,
      spring: 63000, damping: 3500, dampingRebound: 4500, wheelRadius: 0.2,
      steerMax: 0, brake: 'left', maxSinkRate: 12.7,
    },
    {
      name: 'Right main', attach: new Vec3(-0.45, 1.27, 0.35), length: 0.65, travel: 0.15,
      spring: 63000, damping: 3500, dampingRebound: 4500, wheelRadius: 0.2,
      steerMax: 0, brake: 'right', maxSinkRate: 12.7,
    },
  ],
  contacts: [
    { name: 'Propeller tip', pos: new Vec3(2.25, 0, -0.25 + 0.965), kind: 'prop', crashSpeed: 0 },
    { name: 'Lower cowling', pos: new Vec3(1.9, 0, 0.42), kind: 'structure', crashSpeed: 1.5 },
    { name: 'Belly', pos: new Vec3(0.3, 0, 0.5), kind: 'structure', crashSpeed: 1.5 },
    { name: 'Tail tie-down', pos: new Vec3(-4.3, 0, 0.05), kind: 'tail', crashSpeed: 2.0 },
    { name: 'Rudder bottom', pos: new Vec3(-5.6, 0, -0.2), kind: 'tail', crashSpeed: 2.0 },
    { name: 'Left wingtip', pos: new Vec3(0.0, -5.5, -1.17), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Right wingtip', pos: new Vec3(0.0, 5.5, -1.17), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Left stabiliser tip', pos: new Vec3(-4.6, -1.72, -0.2), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Right stabiliser tip', pos: new Vec3(-4.6, 1.72, -0.2), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Fin top', pos: new Vec3(-5.3, 0, -1.72), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Cabin roof', pos: new Vec3(0.4, 0, -1.05), kind: 'structure', crashSpeed: 0.5 },
  ],
  hullPoints: [
    new Vec3(2.45, 0, -0.25), new Vec3(1.5, 0, 0.3), new Vec3(0.3, 0, 0.5), new Vec3(0.4, 0, -1.05),
    new Vec3(0, -5.5, -1.17), new Vec3(0, 5.5, -1.17), new Vec3(0, -2.75, -1.08), new Vec3(0, 2.75, -1.08),
    new Vec3(-2.5, 0, -0.2), new Vec3(-4.6, -1.72, -0.2), new Vec3(-4.6, 1.72, -0.2), new Vec3(-5.3, 0, -1.72),
    new Vec3(-5.6, 0, -0.2),
  ],
  limits: { vne: 163, vno: 129, vfe: 85, vs0: 40, vs1: 48, nMax: 3.8, nMin: -1.52 },
  spawnHeight: 0.95,
  tailArm: 4.6,
  stallWarnAlpha: 12,
  eye: new Vec3(0.18, -0.3, -0.8),
  profile: {
    takeoffTrim: 0.15, takeoffFlapLever: 0,
    approachKias: 75, approachThrottle: 0.48, approachFlapLever: 1, approachTrim: 0.25, approachPitchDeg: -1,
    cruiseKias: 100, cruiseThrottle: 0.65, idleRpm: 800, approachRpm: 2100, cruiseRpm: 2350,
    standClearance: 9,
  },
};
