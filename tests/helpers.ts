import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World, loadWorld, RegionMeta } from '../src/world/world';
import { flatTerrain } from '../src/world/terrain';
import { AirportData } from '../src/world/airport';
import { ObstacleIndex } from '../src/world/obstacles';
import { Simulation, PHYSICS_DT } from '../src/sim/simulation';
import { C172 } from '../src/sim/aircraft/c172';
import { AircraftDef } from '../src/sim/fdm/aircraft';
import { DEFAULT_WEATHER, WeatherSettings } from '../src/sim/weather';
import { KT, FT, DEG, clamp } from '../src/core/math';

export const DATA = join(__dirname, '..', 'public', 'data', 'scot');

export async function loadEGPH(initial: string[] | 'all' = ['egph']): Promise<World> {
  return loadWorld(DATA, async (p) => {
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }, undefined, undefined, initial);
}

/** Flat sea-level test field with a 4 km paved runway heading north (for POH comparisons). */
export function flatWorld(elev = 0): World {
  const airport: AirportData = {
    icao: 'TEST', name: 'Test field', arp: { lat: 55.95, lon: -3.37, elev },
    runways: [{ id: '36/18', width: 45, length: 4000, surface: 'asphalt', ends: [
      { ident: '36', x: 0, y: 0, elev, displaced: 0, hdgTrue: 0 },
      { ident: '18', x: 0, y: 4000, elev, displaced: 0, hdgTrue: 180 },
    ] }],
    runwayLines: [], taxiways: [], aprons: [], stands: [[0, -100, 0]], boundary: [], buildings: [],
    frequencies: {}, navaids: [],
  };
  const meta = { attribution: [] } as unknown as RegionMeta;
  return new World(meta, flatTerrain(elev), airport, new ObstacleIndex());
}

export const CALM_ISA: WeatherSettings = {
  ...DEFAULT_WEATHER, windSpeed: 0, gustSpeed: 0, turbulence: 0, temperatureC: 15, qnh: 1013.25,
};

export function newSim(world: World, weather: WeatherSettings = CALM_ISA, def: AircraftDef = C172) {
  const sim = new Simulation(world, def, { ...weather });
  sim.setWeather({ ...weather });
  return sim;
}

/** Run n seconds of physics with a per-step callback (the "test pilot"). */
export function run(sim: Simulation, seconds: number, pilot?: (t: number) => boolean | void) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    if (pilot && pilot(i * PHYSICS_DT) === true) return i * PHYSICS_DT;
    sim.step();
    if (sim.aircraft.crashed) return i * PHYSICS_DT;
  }
  return seconds;
}

/**
 * Simple PI test pilot that moves the stick (never the aircraft) to hold a target
 * calibrated airspeed via pitch, and wings level / heading via roll.
 */
export class TestPilot {
  private bankI = 0;
  constructor(public sim: Simulation) {}

  private thetaCmd: number | null = null;
  private stickI = 0;

  /** Pitch-attitude inner loop: moves the stick to reach thetaCmd. */
  private pitchTo(thetaCmd: number, dt: number) {
    const ac = this.sim.aircraft;
    const [, theta] = ac.euler;
    const e = thetaCmd - theta;
    this.stickI = clamp(this.stickI + e * dt * 1.5, -1, 1);
    this.sim.controls.pitch = clamp(3 * e + this.stickI - 1.2 * ac.omega.y, -1, 1);
  }

  holdSpeedWithPitch(targetKcas: number, dt = PHYSICS_DT) {
    const ac = this.sim.aircraft;
    if (this.thetaCmd === null) this.thetaCmd = ac.euler[1];
    const err = ac.cas / KT - targetKcas; // positive = too fast -> raise the nose
    this.thetaCmd = clamp(this.thetaCmd + err * 0.15 * DEG * dt, -10 * DEG, 20 * DEG);
    this.pitchTo(clamp(this.thetaCmd + err * 0.4 * DEG, -12 * DEG, 22 * DEG), dt);
  }

  holdAltitudeWithPitch(targetAltM: number, dt = PHYSICS_DT) {
    const ac = this.sim.aircraft;
    if (this.thetaCmd === null) this.thetaCmd = ac.euler[1];
    const vs = -ac.vel.z;
    const vsCmd = clamp((targetAltM - ac.altitude) * 0.12, -4, 4);
    const err = vsCmd - vs;
    // vertical speed -> pitch attitude (integrating), then the attitude loop moves the stick
    // flight-path gain scales with 1/V (1 deg of pitch changes VS more at higher speed)
    const k = 45 / Math.max(ac.tas, 45);
    this.thetaCmd = clamp(this.thetaCmd + err * DEG * dt * k, -10 * DEG, 20 * DEG);
    this.pitchTo(clamp(this.thetaCmd + err * 0.6 * DEG * k, -12 * DEG, 22 * DEG), dt);
  }

  wingsLevel(targetHeading?: number, dt = PHYSICS_DT) {
    const ac = this.sim.aircraft;
    const c = this.sim.controls;
    const [phi, , psi] = ac.euler;
    let bank = 0;
    if (targetHeading !== undefined) {
      let e = targetHeading - psi;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      bank = clamp(e * 1.5, -20 * DEG, 20 * DEG);
    }
    this.bankI = clamp(this.bankI + (bank - phi) * dt * 0.5, -0.3, 0.3);
    c.roll = clamp(2.0 * (bank - phi) + this.bankI - 0.4 * ac.omega.x, -1, 1);
    // coordinate with rudder: drive sideslip to zero
    c.yaw = clamp(ac.beta * 4, -1, 1);
  }
}

export const kt = (ms: number) => ms / KT;
export const ft = (m: number) => m / FT;

export { LandingPilot } from '../src/sim/flightScript';
