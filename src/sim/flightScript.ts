// Scripted pilots for the jets: they fly the aircraft through the normal controls (stick, throttle, gear, flaps), the way a player would, so the flight model
// does the rest. Used by the Director (menu page) to fly an A320 takeoff, a cruise and an approach and landing at a chosen time of day while the user films
// with a free camera. The classes work on a Simulation and are called once per physics step.
import { KT, FT, DEG, clamp } from '../core/math';
import { Simulation, PHYSICS_DT } from './simulation';

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


export type ScriptKind = 'takeoff' | 'cruise' | 'landing';

/** Flare technique per aircraft (found by sweeping the settings headless: flare height as a multiple of the gear height scale, nose-up angle, sink aim, speed offset). */
const LANDING_TUNE: Record<string, { fh: number; fp: number; fs: number; va: number }> = {
  b738: { fh: 16, fp: 6.5, fs: 0.4, va: 0 }, a320: { fh: 20, fp: 8, fs: 0.5, va: 0 }, a340: { fh: 14, fp: 10, fs: 0.4, va: 0 },
  a350: { fh: 22, fp: 4, fs: 0.4, va: 0 }, c17: { fh: 14, fp: 10, fs: 0.4, va: 4 },
};

/** Takeoff, climb-out and cruise: full thrust, steer down the runway, rotate at Vr, gear up, flaps up, level off at the chosen height and hold speed. */
export class TakeoffPilot {
  phase: 'roll' | 'rotate' | 'climb' | 'cruise' = 'roll';
  private psi0: number; private field: number; private vr: number;
  private thetaCmd: number | null = null; private stickI = 0; private bankI = 0; private thrI = 0.7;
  constructor(public sim: Simulation, public cruiseAglFt = 3000, public cruiseKias = 230) {
    const ac = sim.aircraft, c = sim.controls;
    this.psi0 = ac.euler[2]; this.field = ac.altitude;
    this.vr = ac.def.limits.vs1 + 12;
    c.parkingBrake = false; c.brakeLeft = 0; c.brakeRight = 0; c.throttle = 1; c.flapLever = ac.def.profile.takeoffFlapLever; c.trim = 0;
    c.landingLight = true; c.beacon = true; c.strobes = true; c.navLights = true; c.gearDown = true; c.speedbrake = 0; c.reverse = false;
  }
  private pitchTo(theta: number, dt: number) {
    const ac = this.sim.aircraft, c = this.sim.controls;
    const e = theta - ac.euler[1];
    this.stickI = clamp(this.stickI + e * dt * 1.5, -1, 1);
    c.pitch = clamp(3 * e + this.stickI - 1.2 * ac.omega.y, -1, 1);
  }
  private speedPitch(kias: number, dt: number) {
    const ac = this.sim.aircraft;
    if (this.thetaCmd === null) this.thetaCmd = ac.euler[1];
    const err = ac.cas / KT - kias;
    this.thetaCmd = clamp(this.thetaCmd + err * 0.15 * DEG * dt, -10 * DEG, 20 * DEG);
    this.pitchTo(clamp(this.thetaCmd + err * 0.4 * DEG, -12 * DEG, 22 * DEG), dt);
  }
  private altitudePitch(alt: number, dt: number) {
    const ac = this.sim.aircraft;
    if (this.thetaCmd === null) this.thetaCmd = ac.euler[1];
    const err = clamp((alt - ac.altitude) * 0.12, -4, 4) - -ac.vel.z;
    const k = 45 / Math.max(ac.tas, 45);
    this.thetaCmd = clamp(this.thetaCmd + err * DEG * dt * k, -10 * DEG, 20 * DEG);
    this.pitchTo(clamp(this.thetaCmd + err * 0.6 * DEG * k, -12 * DEG, 22 * DEG), dt);
  }
  private wings(dt: number) {
    const ac = this.sim.aircraft, c = this.sim.controls, [phi, , psi] = ac.euler;
    let e = this.psi0 - psi; e = Math.atan2(Math.sin(e), Math.cos(e));
    const bank = clamp(e * 1.5, -20 * DEG, 20 * DEG);
    this.bankI = clamp(this.bankI + (bank - phi) * dt * 0.5, -0.3, 0.3);
    c.roll = clamp(2.0 * (bank - phi) + this.bankI - 0.4 * ac.omega.x, -1, 1);
    c.yaw = clamp(ac.beta * 4, -1, 1);
  }
  step(dt = PHYSICS_DT) {
    const ac = this.sim.aircraft, c = this.sim.controls, [phi, th, psi] = ac.euler, ias = ac.cas / KT;
    const agl = ac.agl, vs = -ac.vel.z;
    if (ac.onGround || agl < 15) {
      let e = this.psi0 - psi; e = Math.atan2(Math.sin(e), Math.cos(e));
      c.throttle = 1; c.yaw = clamp(e * 4 - ac.omega.z * 2, -1, 1); c.roll = clamp(-phi * 2, -1, 1);
      if (ias > this.vr) { this.phase = 'rotate'; const tgt = ac.onGround ? 8 * DEG : 12 * DEG; c.pitch = clamp(1.5 * (tgt - th) - 2.5 * ac.omega.y + 0.2, -1, 1); } else c.pitch = 0;
      return;
    }
    if (this.phase === 'roll' || this.phase === 'rotate') this.phase = 'climb';
    const aglFt = agl / FT;
    if (c.gearDown && agl > 25 && vs > 2) c.gearDown = false;      // positive rate: gear up
    if (aglFt > 1200 && c.flapLever > 0) c.flapLever = 0;          // clean up
    if (this.phase === 'climb') {
      this.wings(dt);
      this.speedPitch(aglFt > 1200 ? 220 : this.vr + 25, dt);
      c.throttle = aglFt > 1000 ? 0.92 : 1;
      if (aglFt > this.cruiseAglFt - 250) this.phase = 'cruise';
    } else {
      this.wings(dt);
      this.altitudePitch(this.field + this.cruiseAglFt * FT, dt);
      const err = this.cruiseKias - ias;
      this.thrI = clamp(this.thrI + err * dt * 0.004, 0.1, 1);
      c.throttle = clamp(this.thrI + err * 0.02, 0.1, 1);
    }
  }
}

/** One scripted flight: the takeoff pilot or the landing pilot, driven once per physics step from Simulation.preStep. */
export class FlightScript {
  readonly kind: ScriptKind;
  private takeoff: TakeoffPilot | null = null;
  private landing: LandingPilot | null = null;
  constructor(public sim: Simulation, kind: ScriptKind, runwayIdent?: string, cruiseAglFt = 3000) {
    this.kind = kind;
    const ac = sim.aircraft, c = sim.controls;
    if (kind === 'landing') {
      const rw = sim.world.airport.runways.flatMap((r) => r.ends).find((e) => e.ident === runwayIdent) ?? sim.world.airport.runways[0].ends[0];
      const k = ac.def.spawnHeight / 3.8;
      c.landingLight = true; c.beacon = true; c.strobes = true; c.navLights = true; c.gearDown = true;
      const tune = LANDING_TUNE[ac.def.id] ?? { fh: 10, fp: 4.5, fs: 0.8, va: 0 };
      this.landing = new LandingPilot(sim, rw.x, rw.y, rw.hdgTrue * DEG, rw.elev, ac.def.profile.approachKias + tune.va, rw.displaced + 350, true, ac.def.spawnHeight + 0.05, tune.fh * k, true, tune.fs, tune.fp);
    } else {
      this.takeoff = new TakeoffPilot(sim, cruiseAglFt);
      if (kind === 'cruise') { this.takeoff.phase = 'cruise'; }
    }
  }
  get phase() { return this.landing ? this.landing.phase : this.takeoff!.phase; }
  get done() { return this.landing ? this.landing.phase === 'stopped' : false; }
  step() { if (this.landing) this.landing.step(); else this.takeoff!.step(); }
}
