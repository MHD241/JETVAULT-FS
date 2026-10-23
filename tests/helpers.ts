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

/**
 * Scripted approach-and-landing pilot for a runway with threshold (x0,y0) and unit
 * direction (ux,uy). Flies a 3 deg path with pitch, holds approach speed with power,
 * flares, touches down and brakes to a stop. Returns per-step status.
 */
export class LandingPilot {
  phase: 'approach' | 'flare' | 'rollout' | 'stopped' = 'approach';
  touchdown: { x: number; y: number; sinkFpm: number; kias: number; pitchDeg: number } | null = null;
  stop: { x: number; y: number } | null = null;
  private thrI = 0.35;
  private flareTheta: number | null = null;
  private flareStick = 0;
  private gsI = 0;
  constructor(
    public sim: Simulation, public x0: number, public y0: number, public hdg: number,
    public fieldElev: number, public vApp = 65, public aim = 300, public brake = true,
    /** wheel height of the datum at rest (gear length), flare height, use reversers */
    public wheelH = 1.0, public flareH = 5, public reversers = false, public flareSink = 0.25,
    /** jet technique: raise the nose by this much and hold the attitude (deg); 0 = sink-rate flare */
    public flarePitchUp = 0,
  ) {}

  /** Along-track distance past the threshold and cross-track (right positive), m. */
  track() {
    const ac = this.sim.aircraft;
    const ux = Math.sin(this.hdg), uy = Math.cos(this.hdg);
    const dx = ac.pos.y - this.x0, dy = ac.pos.x - this.y0;
    return { along: dx * ux + dy * uy, cross: dx * uy - dy * ux };
  }

  step(dt = PHYSICS_DT) {
    const ac = this.sim.aircraft, c = this.sim.controls;
    const [phi, th, psi] = ac.euler;
    const ias = ac.cas / KT;
    const { along, cross } = this.track();
    const hgt = ac.altitude - this.fieldElev - this.wheelH; // wheel height approx
    let hdgErr = this.hdg - psi; hdgErr = Math.atan2(Math.sin(hdgErr), Math.cos(hdgErr));
    // lateral: track the centreline
    const trackCmd = clamp(-cross * 0.004, -0.25, 0.25);
    const bankCmd = this.phase === 'approach' ? clamp((hdgErr + trackCmd) * 2.5, -15 * DEG, 15 * DEG) : 0;
    if (this.phase !== 'rollout' && this.phase !== 'stopped') {
      c.roll = clamp(2.0 * (bankCmd - phi) - 0.4 * ac.omega.x, -1, 1);
      c.yaw = clamp(ac.beta * 4, -1, 1);
    }
    if (this.phase === 'approach') {
      const dist = this.aim - along;
      const gpH = Math.tan(3 * DEG) * dist;
      const gs = ac.vel.len();
      const vsCmd = -Math.tan(3 * DEG) * gs + clamp((gpH - hgt) * 0.12, -2, 2);
      const vs = -ac.vel.z;
      this.gsI = clamp(this.gsI + (vsCmd - vs) * dt * 0.02, -0.3, 0.3);
      const thetaCmd = clamp(th + (vsCmd - vs) * 0.03 + this.gsI, -10 * DEG, 12 * DEG);
      c.pitch = clamp(c.pitch + (3 * (thetaCmd - th) - 1.2 * ac.omega.y - c.pitch) * 0.05, -1, 1);
      this.thrI = clamp(this.thrI + (this.vApp - ias) * dt * 0.01, 0, 1);
      c.throttle = clamp(this.thrI + (this.vApp - ias) * 0.03, 0, 1);
      if (hgt < this.flareH) this.phase = 'flare';
    } else if (this.phase === 'flare') {
      c.throttle = 0;
      const vs = -ac.vel.z;
      const vsCmd = -clamp(hgt * 0.5, this.flareSink, 3);
      if (this.flarePitchUp > 0 && this.flareTheta === null) { this.flareTheta = th + this.flarePitchUp * DEG; this.flareStick = c.pitch; }
      const thetaCmd = this.flareTheta !== null ? this.flareTheta : clamp(th + (vsCmd - vs) * 0.04, -2 * DEG, 11 * DEG);
      c.pitch = this.flareTheta !== null
        ? clamp(this.flareStick + 1.2 * (thetaCmd - th) / DEG * 0.05 - 1.5 * ac.omega.y, -1, 1)
        : clamp(4 * (thetaCmd - th) - 1.2 * ac.omega.y, -1, 1);
      if (ac.gearStates[1].contact || ac.gearStates[2].contact) {
        this.phase = 'rollout';
        this.touchdown = {
          x: ac.pos.y, y: ac.pos.x, kias: ias, pitchDeg: th / DEG,
          sinkFpm: (Math.max(ac.gearStates[1].touchdownSink, ac.gearStates[2].touchdownSink) / FT) * 60,
        };
      }
    } else if (this.phase === 'rollout') {
      c.throttle = 0;
      c.pitch = ac.gearStates[0].contact ? 0.2 : clamp(4 * (6 * DEG - th), -0.2, 1);
      c.roll = clamp(-phi * 2, -1, 1);
      c.yaw = clamp(hdgErr * 6 - cross * 0.05 - ac.omega.z * 2, -1, 1);
      const b = this.brake && ac.gearStates[0].contact ? 1 : 0;
      c.brakeLeft = b; c.brakeRight = b;
      if (this.reversers) { c.reverse = ac.vel.len() > 30; c.throttle = c.reverse ? 0.8 : 0; c.speedbrake = 1; }
      if (ac.vel.len() < 0.05) { this.phase = 'stopped'; this.stop = { x: ac.pos.y, y: ac.pos.x }; }
    }
  }
}
