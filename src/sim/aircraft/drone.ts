// "Inspection drone" (TEMPORARY tool for building and checking the world quickly): the Darter airframe (a heavy, thin-winged
// glider that is happy at speed and is built for the bungee launch) plus a motor that holds a speed you choose with the 1..9 keys
// (1 = motor off, 2..9 = 87 .. 780 kt in steps). It can take off under its own power or be bungee-launched (N). Fictional, no real data.
import { AircraftDef } from '../fdm/aircraft';
import { DARTER } from './darter';

export const DRONE: AircraftDef = {
  ...DARTER,
  id: 'drone',
  name: 'Inspection drone (temporary tool)',
  drone: { vMin: 45, vMax: 400, maxAccel: 30 },
};
