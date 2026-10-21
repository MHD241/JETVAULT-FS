// Boeing 737-800 (Next Generation) - aircraft definition.
//
// PUBLIC DATA (Boeing 737 Airplane Characteristics for Airport Planning, D6-58325-6, and
// type certificate data): wingspan 35.79 m with winglets (34.32 m without), length
// 39.47 m, height 12.55 m, wing area 124.6 m^2, quarter-chord sweep 25 deg, MTOW 79,016 kg,
// MLW 66,361 kg, OEW ~41,400 kg, fuel capacity 26,020 L, wheelbase 15.6 m, main gear
// track 5.72 m, CFM56-7B26 engines rated 26,300 lbf (117 kN).
// ESTIMATES (not Boeing data): section aerodynamics, flap/slat increments, inertia,
// gear spring/damper rates, control travels, engine spool and lapse. They are tuned so the
// simulation reproduces typical published operating figures (rotation ~145-155 KIAS at
// 65-70 t with flaps 5; Vref30 ~140-145 kt at 60-65 t) - see tests/b738.test.ts.
//
// Body frame (FRD), metres; datum on the fuselage centreline near 25 % MAC.

import { Vec3, Inertia, DEG } from '../../core/math';
import { AircraftDef, AeroSurfaceDef } from '../fdm/aircraft';
import { AirfoilParams, ControlParams } from '../fdm/aero';

const WING: AirfoilParams = { a0: 5.6, alpha0: -4.0 * DEG, clMax: 1.5, clMin: -1.0, cd0: 0.0062, cdK: 0.004, cm0: -0.06 };
const TAIL: AirfoilParams = { a0: 5.0, alpha0: 0, clMax: 1.1, clMin: -1.1, cd0: 0.0065, cdK: 0.005, cm0: 0 };
const FLAP: ControlParams = { effectiveness: 0.42, dClMaxPerRad: 1.7, cdPerRad2: 0.3, cmPerRad: -1.0, fowler: { exponent: 0.55, maxDefl: 40 * DEG } }; // Fowler: CP moves aft
const AILERON: ControlParams = { effectiveness: 0.4, dClMaxPerRad: 0.3, cdPerRad2: 0.15, cmPerRad: -0.3 };
const ELEVATOR: ControlParams = { effectiveness: 0.45, dClMaxPerRad: 0.5, cdPerRad2: 0.1, cmPerRad: -0.35 };
const RUDDER: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.5, cdPerRad2: 0.1, cmPerRad: -0.35 };

const S = 124.6;
const SPAN = 34.32;
const AR = (SPAN * SPAN) / S; // ~9.45
const SWEEP = 25 * DEG;
const DIHEDRAL = 6 * DEG;
const ROOT_Y = 1.9; // fuselage side
const QC_ROOT_X = 2.5; // quarter-chord at the wing root
const WING_Z = 1.3; // low wing, below the centreline

export function b738ChordAt(y: number) {
  return y < 6.3 ? 6.2 - ((6.2 - 4.3) * (y - ROOT_Y)) / (6.3 - ROOT_Y) : 4.3 - ((4.3 - 1.25) * (y - 6.3)) / (17.16 - 6.3);
}
export function b738QcX(y: number) { return QC_ROOT_X - (y - ROOT_Y) * Math.tan(SWEEP); }
export function b738WingZ(y: number) { return WING_Z - (y - ROOT_Y) * Math.tan(DIHEDRAL); }

function wing(): AeroSurfaceDef[] {
  const bands: [number, number, 'flap' | 'aileron', boolean][] = [
    [1.9, 4.5, 'flap', false], [4.5, 7.2, 'flap', true], [7.2, 10.4, 'flap', true], [10.4, 13.8, 'aileron', true], [13.8, 17.16, 'aileron', false],
  ];
  let exposed = 0;
  for (const [a, b] of bands) exposed += ((b738ChordAt(a) + b738ChordAt(b)) / 2) * (b - a);
  const scale = S / (2 * exposed);
  const out: AeroSurfaceDef[] = [];
  for (const side of [-1, 1]) {
    bands.forEach(([a, b, kind, spoiler], i) => {
      const y = (a + b) / 2;
      const chord = (b738ChordAt(a) + b738ChordAt(b)) / 2;
      const left = side < 0;
      out.push({
        name: `wing${left ? 'L' : 'R'}${i + 1}`,
        pos: new Vec3(b738QcX(y), side * y, b738WingZ(y)),
        area: chord * (b - a) * scale, chord,
        normal: new Vec3(0, -side * Math.sin(DIHEDRAL), -Math.cos(DIHEDRAL)),
        incidence: (1.0 - 3.0 * ((y - ROOT_Y) / (17.16 - ROOT_Y))) * DEG,
        aspectRatio: AR, oswald: 0.82, span: SPAN,
        airfoil: WING,
        control: kind === 'flap' ? FLAP : AILERON,
        channel: kind === 'flap' ? 'flap' : left ? 'aileronL' : 'aileronR',
        slipstream: 0, downwash: false, role: 'wing',
        spoiler, slatClMax: 0.45,
      });
    });
  }
  return out;
}

const HT_S = 32.78, HT_SPAN = 14.35;

export const B738: AircraftDef = {
  id: 'b738',
  name: 'Boeing 737-800',
  emptyMass: 41413,
  emptyCG: new Vec3(-0.6, 0, 0.2),
  refInertia: new Inertia(1.0e6, 3.3e6, 4.1e6, 0), // ESTIMATE at 65 t
  refMass: 65000,
  maxTakeoffMass: 79016,
  stations: [
    { name: 'Passengers and cargo', pos: new Vec3(0.3, 0, 0.3), mass: 12000, max: 20500 },
  ],
  tanks: [
    // wing + half of the centre tank each side (centre tank not modelled separately)
    { name: 'Left (incl. half centre)', pos: new Vec3(0.8, -3.5, 1.2), capacity: 10447, unusable: 50, side: 'LEFT' },
    { name: 'Right (incl. half centre)', pos: new Vec3(0.8, 3.5, 1.2), capacity: 10447, unusable: 50, side: 'RIGHT' },
  ],
  wingArea: S,
  wingSpan: SPAN,
  mac: 3.96,
  surfaces: [
    ...wing(),
    ...[-1, 1].map((side): AeroSurfaceDef => ({
      name: side < 0 ? 'htailL' : 'htailR',
      pos: new Vec3(-16.6, side * 3.6, -0.6), area: HT_S / 2, chord: 2.6,
      normal: new Vec3(0, 0, -1), incidence: -1.2 * DEG,
      aspectRatio: (HT_SPAN * HT_SPAN) / HT_S, oswald: 0.8, span: HT_SPAN,
      airfoil: TAIL, control: ELEVATOR, channel: 'elevator', slipstream: 0, downwash: true, role: 'htail',
    })),
    {
      name: 'fin', pos: new Vec3(-17.6, 0, -4.9), area: 26.44, chord: 4.6,
      normal: new Vec3(0, 1, 0), incidence: 0, aspectRatio: 2.2, oswald: 0.75, span: 7.2,
      airfoil: TAIL, control: RUDDER, channel: 'rudder', slipstream: 0, downwash: false, role: 'vtail',
    },
  ],
  controls: {
    elevatorUp: 22 * DEG, elevatorDown: 15 * DEG,
    aileronUp: 20 * DEG, aileronDown: 15 * DEG,
    rudder: 26 * DEG,
    trimRange: 9 * DEG, // stabiliser trim expressed as equivalent elevator (ESTIMATE)
    aileronRig: 0,
    // flap lever detents 0,1,2,5,10,15,25,30,40 (flap angle equals the detent in degrees)
    flapDetents: [0, 1, 2, 5, 10, 15, 25, 30, 40].map((d) => d * DEG),
    flapRate: 1.3 * DEG,
    surfaceTau: 0.15,
  },
  fuselage: { pos: new Vec3(-1.0, 0, 0), dragArea: 1.55, sideArea: 125, planArea: 120, munkVolume: 340, munkVolumeYaw: 350 },
  turbofans: [
    { def: { ratedThrust: 117000, idleN1: 21, maxN1: 101, reverseFraction: 0.4, tsfc: 1.0e-5, idleFuelFlow: 0.07 }, pos: new Vec3(6.0, -4.9, 2.3) },
    { def: { ratedThrust: 117000, idleN1: 21, maxN1: 101, reverseFraction: 0.4, tsfc: 1.0e-5, idleFuelFlow: 0.07 }, pos: new Vec3(6.0, 4.9, 2.3) },
  ],
  retractableGear: { time: 8, dragArea: 2.5 },
  gear: [
    {
      name: 'Nose', attach: new Vec3(14.1, 0, 1.6), length: 2.45, travel: 0.4,
      spring: 3.0e5, damping: 6.0e4, dampingRebound: 9.0e4, wheelRadius: 0.38,
      steerMax: 70 * DEG, steerHighSpeed: 7 * DEG, brake: null, maxSinkRate: 3.5,
    },
    {
      name: 'Left main', attach: new Vec3(-1.5, -2.86, 1.5), length: 2.55, travel: 0.5,
      spring: 1.15e6, damping: 1.6e5, dampingRebound: 2.6e5, wheelRadius: 0.56,
      steerMax: 0, brake: 'left', maxSinkRate: 4.0,
    },
    {
      name: 'Right main', attach: new Vec3(-1.5, 2.86, 1.5), length: 2.55, travel: 0.5,
      spring: 1.15e6, damping: 1.6e5, dampingRebound: 2.6e5, wheelRadius: 0.56,
      steerMax: 0, brake: 'right', maxSinkRate: 4.0,
    },
  ],
  contacts: [
    { name: 'Aft fuselage (tail strike)', pos: new Vec3(-13.5, 0, 1.5), kind: 'tail', crashSpeed: 2.0 },
    { name: 'Left engine nacelle', pos: new Vec3(6.5, -4.9, 3.3), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Right engine nacelle', pos: new Vec3(6.5, 4.9, 3.3), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Nose', pos: new Vec3(16.5, 0, 1.6), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Belly', pos: new Vec3(0, 0, 1.95), kind: 'structure', crashSpeed: 1.0 },
    { name: 'Left wingtip', pos: new Vec3(b738QcX(17.2) - 0.5, -17.9, b738WingZ(17.2)), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Right wingtip', pos: new Vec3(b738QcX(17.2) - 0.5, 17.9, b738WingZ(17.2)), kind: 'structure', crashSpeed: 0.5 },
    { name: 'Fin top', pos: new Vec3(-20.5, 0, -8.7), kind: 'structure', crashSpeed: 0.5 },
  ],
  hullPoints: [
    new Vec3(17.5, 0, 0), new Vec3(10, 0, -1.9), new Vec3(0, 0, -1.9), new Vec3(-12, 0, -1.6), new Vec3(-20.5, 0, -8.7),
    new Vec3(b738QcX(17), -17.8, b738WingZ(17)), new Vec3(b738QcX(17), 17.8, b738WingZ(17)),
    new Vec3(b738QcX(9), -9, b738WingZ(9)), new Vec3(b738QcX(9), 9, b738WingZ(9)),
    new Vec3(8.5, -4.9, 2.3), new Vec3(8.5, 4.9, 2.3), new Vec3(-17.5, -7.1, -0.6), new Vec3(-17.5, 7.1, -0.6),
  ],
  limits: { vne: 340, vno: 340, vfe: 162, vs0: 110, vs1: 140, nMax: 2.5, nMin: -1.0 },
  spawnHeight: 3.85,
  tailArm: 17,
  stallWarnAlpha: 12,
  eye: new Vec3(14.2, -0.53, -0.72),
  profile: {
    takeoffTrim: 0.25, takeoffFlapLever: 3,
    approachKias: 145, approachThrottle: 0.55, approachFlapLever: 7, approachTrim: 0.3, approachPitchDeg: 1.5,
    cruiseKias: 250, cruiseThrottle: 0.75, idleRpm: 2100, approachRpm: 6200, cruiseRpm: 8000,
    standClearance: 20,
  },
};
