// "Darter": a fictional high-speed rocket-launch glider for the bungee launch (NOT a real aircraft, no real data).
// Short, thin, swept-looking wing (area 5.6 m^2, span 6 m), small tail, heavy (480 kg) so it carries its launch speed,
// streamlined fuselage, very low drag at high speed and wave drag only above Mach 0.9. Landing speed is high (~80 kt).

import { Vec3, Inertia, DEG } from '../../core/math';
import { AircraftDef, AeroSurfaceDef } from '../fdm/aircraft';
import { AirfoilParams, ControlParams } from '../fdm/aero';
import { GLIDER } from './glider';

const AF: AirfoilParams = { a0: 4.6, alpha0: -1.0 * DEG, clMax: 0.95, clMin: -0.95, cd0: 0.0048, cdK: 0.004, cm0: -0.02 };
const TAIL: AirfoilParams = { a0: 4.4, alpha0: 0, clMax: 0.9, clMin: -0.9, cd0: 0.006, cdK: 0.005, cm0: 0 };
const AIL: ControlParams = { effectiveness: 0.4, dClMaxPerRad: 0.2, cdPerRad2: 0.12, cmPerRad: -0.3 };
const NOFLAP: ControlParams = { effectiveness: 0, dClMaxPerRad: 0, cdPerRad2: 0, cmPerRad: 0 };
const ELEV: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.4, cdPerRad2: 0.1, cmPerRad: -0.4 };
const RUD: ControlParams = { effectiveness: 0.5, dClMaxPerRad: 0.4, cdPerRad2: 0.1, cmPerRad: -0.4 };

const SPAN = 6.0, AREA = 5.6, AR = (SPAN * SPAN) / AREA, HALF = SPAN / 2, WZ = -0.28, WX = 0.25;
const chordAt = (y: number) => 2.0 - (y / HALF) * 1.3; // 2.0 m root -> 0.7 m tip

function wing(): AeroSurfaceDef[] {
  const st: [number, number, 'plain' | 'aileron'][] = [[0.3, 1.0, 'plain'], [1.0, 1.8, 'plain'], [1.8, 2.4, 'aileron'], [2.4, 3.0, 'aileron']];
  let exp = 0; for (const [a, b] of st) exp += ((chordAt(a) + chordAt(b)) / 2) * (b - a);
  const k = AREA / (2 * exp), out: AeroSurfaceDef[] = [];
  for (const side of [-1, 1]) st.forEach(([a, b, kind], i) => {
    const y = (a + b) / 2, chord = (chordAt(a) + chordAt(b)) / 2, left = side < 0;
    out.push({
      name: `wing${left ? 'L' : 'R'}${i + 1}`, pos: new Vec3(WX - y * 0.35, side * y, WZ), area: chord * (b - a) * k, chord,
      normal: new Vec3(0, 0, -1), incidence: 1.0 * DEG, aspectRatio: AR, oswald: 0.85, span: SPAN, airfoil: AF,
      control: kind === 'aileron' ? AIL : NOFLAP, channel: kind === 'aileron' ? (left ? 'aileronL' : 'aileronR') : 'flap',
      slipstream: 0, downwash: false, role: 'wing', spoiler: false,
    });
  });
  return out;
}

const surfaces: AeroSurfaceDef[] = [
  ...wing(),
  ...[-1, 1].map((side): AeroSurfaceDef => ({
    name: side < 0 ? 'htailL' : 'htailR', pos: new Vec3(-3.6, side * 0.6, -0.5), area: 0.7, chord: 0.8,
    normal: new Vec3(0, 0, -1), incidence: -0.8 * DEG, aspectRatio: 2.0, oswald: 0.8, span: 1.6, airfoil: TAIL, control: ELEV, channel: 'elevator',
    slipstream: 0, downwash: true, role: 'htail',
  })),
  { name: 'fin', pos: new Vec3(-3.7, 0, -0.55), area: 0.9, chord: 1.0, normal: new Vec3(0, 1, 0), incidence: 0, aspectRatio: 1.4, oswald: 0.7, span: 1.2, airfoil: TAIL, control: RUD, channel: 'rudder', slipstream: 0, downwash: false, role: 'vtail' },
];

export const DARTER: AircraftDef = {
  ...GLIDER,
  id: 'darter',
  name: 'Darter (bungee-launch rocket glider, fictional)',
  emptyMass: 440, refMass: 480, maxTakeoffMass: 560,
  refInertia: new Inertia(900, 1900, 2500, 0),
  wingArea: AREA, wingSpan: SPAN, mac: 1.4,
  surfaces,
  wave: { mach: 0.9, k: 0.06 },
  fuselage: { pos: new Vec3(0.2, 0, 0), dragArea: 0.02, sideArea: 2.4, planArea: 1.8, munkVolume: 0.7, munkVolumeYaw: 0.9 },
  tailArm: 3.9,
  stallWarnAlpha: 12,
  contacts: GLIDER.contacts.map((c) => c.name.includes('wingtip') ? { ...c, pos: new Vec3(c.pos.x, Math.sign(c.pos.y) * 3.0, c.pos.z) } : c.name.includes('Tailplane') ? { ...c, pos: new Vec3(-3.7, Math.sign(c.pos.y) * 0.85, -0.5) } : c.name === 'Fin top' ? { ...c, pos: new Vec3(-3.7, 0, -1.1) } : c),
};
