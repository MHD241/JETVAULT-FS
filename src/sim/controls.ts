import { MagSwitch } from './fdm/piston';

export type FuelSelector = 'OFF' | 'LEFT' | 'RIGHT' | 'BOTH';

/** Pilot inputs and switch positions. Everything the cockpit can change lives here. */
export interface FlightControls {
  /** -1 (full push) .. +1 (full pull). */
  pitch: number;
  /** -1 (left) .. +1 (right). */
  roll: number;
  /** -1 (left pedal) .. +1 (right pedal). */
  yaw: number;
  throttle: number; // 0..1
  mixture: number; // 0..1
  /** Flap lever detent index into the aircraft's flap settings. */
  flapLever: number;
  /** Elevator trim -1 (nose down) .. +1 (nose up). */
  trim: number;
  brakeLeft: number; // 0..1
  brakeRight: number; // 0..1
  parkingBrake: boolean;
  mags: MagSwitch;
  masterBattery: boolean;
  masterAlternator: boolean;
  avionics: boolean;
  fuelPump: boolean;
  fuelSelector: FuelSelector;
  beacon: boolean;
  navLights: boolean;
  strobes: boolean;
  taxiLight: boolean;
  landingLight: boolean;
  pitotHeat: boolean;
  /** Altimeter Kollsman setting, hPa. */
  kollsman: number;
  /** Heading bug, deg magnetic. */
  headingBug: number;
  /** Landing gear lever (retractable-gear aircraft). */
  gearDown: boolean;
  /** Speedbrake / spoiler lever 0..1. */
  speedbrake: number;
  /** Thrust reversers commanded (jets; only effective on the ground at idle). */
  reverse: boolean;
}

export function defaultControls(): FlightControls {
  return {
    pitch: 0, roll: 0, yaw: 0, throttle: 0, mixture: 1, flapLever: 0, trim: 0,
    brakeLeft: 0, brakeRight: 0, parkingBrake: true, mags: 'OFF', masterBattery: false,
    masterAlternator: false, avionics: false, fuelPump: false, fuelSelector: 'BOTH',
    beacon: false, navLights: false, strobes: false, taxiLight: false, landingLight: false,
    pitotHeat: false, kollsman: 1013.25, headingBug: 0,
    gearDown: true, speedbrake: 0, reverse: false,
  };
}

/** Elevator trim position marked "TAKEOFF": hands-off full-power climb near 70-80 KIAS. */
export const TAKEOFF_TRIM = 0.15;

/** Controls for an aircraft ready to fly (engine running, systems on, trim set for takeoff). */
export function readyControls(trim = TAKEOFF_TRIM, flapLever = 0): FlightControls {
  return {
    ...defaultControls(), mags: 'BOTH', masterBattery: true, masterAlternator: true, avionics: true,
    beacon: true, navLights: true, strobes: true, parkingBrake: false, throttle: 0.1, mixture: 1,
    trim, flapLever,
  };
}
