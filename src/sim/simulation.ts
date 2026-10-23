// Simulation orchestrator: fixed-step physics (240 Hz) decoupled from the render rate.

import { Vec3, DEG, KT } from '../core/math';
import { Aircraft, AircraftDef, Environment } from './fdm/aircraft';
import { C172Systems } from './systems/c172Systems';
import { FlightControls, defaultControls, readyControls } from './controls';
import { WindModel, WeatherSettings, DEFAULT_WEATHER, atmosphereFromWeather } from './weather';
import { World } from '../world/world';
import { runwayEnd } from '../world/airport';
import { Autopilot } from './autopilot';
import { LiftField } from './lift';

export const PHYSICS_HZ = 240;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

export type SpawnKind = { kind: 'stand'; index: number; coldAndDark: boolean }
  | { kind: 'runway'; ident: string }
  | { kind: 'approach'; ident: string; distanceNm: number };

export class Simulation {
  aircraft: Aircraft;
  systems: C172Systems;
  controls: FlightControls;
  weather: WeatherSettings;
  wind: WindModel;
  env: Environment;
  autopilot: Autopilot;
  lift: LiftField;
  paused = false;
  timeScale = 1;
  simTime = 0;
  private acc = 0;
  /** Measured cost of physics per rendered frame (ms), for profiling. */
  physicsMs = 0;
  stepsLastFrame = 0;

  constructor(public world: World, public def: AircraftDef, weather: WeatherSettings = { ...DEFAULT_WEATHER }) {
    this.weather = weather;
    this.wind = new WindModel(this.weather, 7);
    this.aircraft = new Aircraft(def);
    this.controls = defaultControls();
    this.lift = new LiftField({ heightAt: (e, n) => this.world.heightAt(e, n) }, () => this.weather, this.wind, () => this.simTime);
    this.env = this.makeEnv();
    this.systems = new C172Systems(this.aircraft, false);
    this.autopilot = new Autopilot();
  }

  private makeEnv(): Environment {
    const fieldElev = this.world.airport.arp.elev;
    const self = this;
    return {
      get atmosphere() { return atmosphereFromWeather(self.weather, fieldElev); },
      wind: (agl: number) => this.wind.windAt(agl),
      lift: (n: number, e: number, alt: number, agl: number) => this.lift.at(n, e, alt, agl),
      ground: this.world,
      obstacles: this.world.obstacles,
    };
  }

  setWeather(w: WeatherSettings) {
    this.weather = w;
    this.wind.settings = w;
    this.world.wetRunway = w.rain > 0.1;
    this.controls.kollsman = w.qnh;
  }

  spawn(s: SpawnKind) {
    const ap = this.world.airport;
    const ac = this.aircraft;
    const P = this.def.profile;
    this.autopilot.disengage();
    ac.gearExt = 1; ac.spoiler = 0;
    ac.maxLoadFactor = 1; ac.minLoadFactor = 1;
    ac.flap = 0; ac.elevator = 0; ac.aileronL = 0; ac.aileronR = 0; ac.rudder = 0;
    if (s.kind === 'stand') {
      const list = this.def.profile.standClearance > 12 && ap.standsJet?.length ? ap.standsJet : ap.stands;
      const [x, y, hdgDeg] = list[s.index % list.length];
      const hdg = hdgDeg * DEG;
      this.controls = s.coldAndDark ? defaultControls() : readyControls(this.def.profile.takeoffTrim, this.def.profile.takeoffFlapLever);
      this.controls.parkingBrake = true;
      this.controls.kollsman = this.weather.qnh;
      for (const e of ac.engines) { if (s.coldAndDark) { e.rpm = 0; e.running = false; } else e.warmUp(P.idleRpm, ac.air); }
      ac.placeOnGround(x, y, hdg, this.env);
      this.systems = new C172Systems(ac, !s.coldAndDark);
    } else if (s.kind === 'runway') {
      const { end, other } = runwayEnd(ap, s.ident);
      const hdg = Math.atan2(other.x - end.x, other.y - end.y);
      const L = Math.hypot(other.x - end.x, other.y - end.y);
      const t = (end.displaced + 15) / L;
      const x = end.x + (other.x - end.x) * t, y = end.y + (other.y - end.y) * t;
      this.controls = readyControls(this.def.profile.takeoffTrim, this.def.profile.takeoffFlapLever);
      this.controls.kollsman = this.weather.qnh;
      this.controls.parkingBrake = false;
      this.controls.brakeLeft = 0; this.controls.brakeRight = 0;
      this.controls.landingLight = true; this.controls.taxiLight = false;
      for (const e of ac.engines) e.warmUp(P.idleRpm, ac.air);
      ac.flap = this.def.controls.flapDetents[P.takeoffFlapLever];
      ac.placeOnGround(x, y, hdg, this.env);
      this.systems = new C172Systems(ac, true);
      this.bugToHeading();
    } else {
      const { end, other } = runwayEnd(ap, s.ident);
      const hdg = Math.atan2(other.x - end.x, other.y - end.y);
      const d = s.distanceNm * 1852;
      const ux = Math.sin(hdg), uy = Math.cos(hdg);
      // 3 degree glide path to a touchdown point 300 m beyond the displaced threshold
      const tdx = end.x + ux * (end.displaced + 300), tdy = end.y + uy * (end.displaced + 300);
      const x = tdx - ux * d, y = tdy - uy * d;
      const alt = end.elev + Math.tan(3 * DEG) * d;
      this.controls = readyControls(this.def.profile.takeoffTrim, this.def.profile.takeoffFlapLever);
      this.controls.kollsman = this.weather.qnh;
      this.controls.throttle = P.approachThrottle;
      this.controls.flapLever = P.approachFlapLever;
      this.controls.trim = P.approachTrim;
      this.controls.landingLight = true;
      for (const e of ac.engines) e.warmUp(P.approachRpm, ac.air);
      ac.flap = this.def.controls.flapDetents[P.approachFlapLever];
      ac.gearExt = 1;
      ac.placeInFlight(x, y, alt, hdg, P.approachKias * KT, P.approachPitchDeg * DEG);
      // glide path descent rate
      ac.vel = ac.vel.add(new Vec3(0, 0, Math.tan(3 * DEG) * P.approachKias * KT));
      this.systems = new C172Systems(ac, true);
      this.bugToHeading();
    }
  }

  /** Airborne start at local east/north, altitude (ft MSL) and true heading (rad). */
  spawnAir(east: number, north: number, altFt: number, heading: number) {
    const ac = this.aircraft;
    const P = this.def.profile;
    this.autopilot.disengage();
    this.controls = readyControls(this.def.profile.takeoffTrim, this.def.profile.takeoffFlapLever);
    this.controls.kollsman = this.weather.qnh;
    this.controls.throttle = P.cruiseThrottle;
    this.controls.gearDown = !this.def.retractableGear;
    ac.gearExt = this.def.retractableGear ? 0 : 1;
    this.controls.trim = 0;
    this.controls.headingBug = Math.round(((heading * 180) / Math.PI + 360) % 360);
    for (const e of ac.engines) e.warmUp(P.cruiseRpm, ac.air);
    ac.flap = 0;
    const alt = Math.max(altFt * 0.3048, this.world.heightAt(east, north) + 300);
    ac.placeInFlight(east, north, alt, heading, P.cruiseKias * KT, 0);
    this.systems = new C172Systems(ac, true);
  }

  /** Point the heading bug at the current heading (magnetic, ~1 deg W variation). */
  private bugToHeading() {
    this.controls.headingBug = Math.round(((this.aircraft.euler[2] * 180) / Math.PI + 1 + 360) % 360);
  }

  /** Winch launch: a cable to a winch 1,400 m ahead along the heading (glider stopped on the ground). */
  startWinch(): boolean {
    const ac = this.aircraft;
    if (!ac.def.glider || !ac.onGround || Math.hypot(ac.vel.x, ac.vel.y) > 1.5) return false;
    const fwd = ac.q.rotate(new Vec3(1, 0, 0));
    const h = Math.hypot(fwd.x, fwd.y) || 1;
    const n = ac.pos.x + (fwd.x / h) * 1400, e = ac.pos.y + (fwd.y / h) * 1400;
    const anchor = new Vec3(n, e, -(this.world.heightAt(e, n) + 1.5));
    ac.cable = { anchor, vTarget: 28, tMax: 4500, t: 0 };
    return true;
  }

  releaseCable() { this.aircraft.cable = null; }

  /** One fixed physics step. */
  step() {
    const ac = this.aircraft;
    const c = this.controls;
    this.wind.step(PHYSICS_DT, Math.max(ac.agl, 0), ac.tas);
    this.autopilot.apply(PHYSICS_DT, ac, this.systems, c);
    this.systems.stepSystems(PHYSICS_DT, c);
    ac.step(PHYSICS_DT, this.autopilot.effectiveControls(c), this.env, this.systems.fuelAvailable(c), this.systems.busPowered());
    this.systems.updateIndications(PHYSICS_DT, c);
    if (ac.cable) {
      // winch driver cuts the cable when the glider is too steep, nearly overhead, or the launch is over
      const dv = ac.cable.anchor.sub(ac.worldPoint(ac.def.hook!));
      const horiz = Math.hypot(dv.x, dv.y);
      const angle = Math.atan2(ac.altitude + ac.cable.anchor.z, Math.max(horiz, 1));
      if (ac.cable.t > 3 && (angle > 62 * DEG || horiz < 120 || ac.cable.t > 60)) ac.cable = null;
    }
    this.simTime += PHYSICS_DT;
  }

  /** Advance by real elapsed time (s). Returns the number of physics steps taken. */
  advance(realDt: number) {
    if (this.paused) { this.stepsLastFrame = 0; return 0; }
    this.acc += Math.min(realDt, 0.1) * this.timeScale;
    let n = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    while (this.acc >= PHYSICS_DT && n < PHYSICS_HZ) {
      this.step();
      this.acc -= PHYSICS_DT;
      n++;
    }
    this.physicsMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
    this.stepsLastFrame = n;
    return n;
  }

  /** Interpolation fraction between the last two physics states (for smooth rendering). */
  get alpha() { return this.acc / PHYSICS_DT; }
}
