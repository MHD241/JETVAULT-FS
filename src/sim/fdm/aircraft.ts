// Six-degree-of-freedom rigid body aircraft assembled from lifting surfaces, a fuselage
// body, a propeller/engine and landing gear. All motion results from forces and moments:
// the controls only move control surfaces, the throttle only changes engine air flow,
// the brakes only change tyre friction.

import { Vec3, Quat, Inertia, DEG, clamp, moveToward, approach } from '../../core/math';
import { AirState, airAt, AtmosphereConditions, impactPressure, casFromImpactPressure } from '../atmosphere';
import { SurfaceDef, SectionModel, groundEffectFactor } from './aero';
import { PistonEngine, PistonEngineDef, PropellerDef } from './piston';
import { TurbofanEngine, TurbofanDef } from './turbofan';

export type EngineModel = PistonEngine | TurbofanEngine;
import {
  GearDef, ContactPointDef, GearState, newGearState, gearForces, contactPointForces, GroundQuery,
  ContactEvent, BodyKinematics,
} from './gear';
import { FlightControls } from '../controls';
import { ObstacleIndex } from '../../world/obstacles';

export type ControlChannel = 'aileronL' | 'aileronR' | 'elevator' | 'rudder' | 'flap';

export interface AeroSurfaceDef extends SurfaceDef {
  channel?: ControlChannel;
  /** Spoiler panels on this strip (speedbrake lever dumps lift and adds drag). */
  spoiler?: boolean;
  /** Leading-edge slat: clMax increase when flaps are out. */
  slatClMax?: number;
  /** Drag coefficient added by the spoilers at full extension (default 0.08). */
  spoilerCd?: number;
}

export interface MassStation { name: string; pos: Vec3; mass: number; max: number }
export interface FuelTank { name: string; pos: Vec3; capacity: number; unusable: number; side: 'LEFT' | 'RIGHT' }

export interface AircraftDef {
  id: string;
  name: string;
  emptyMass: number;
  emptyCG: Vec3;
  /** Inertia about the CG at refMass (kg m^2); scaled with mass. */
  refInertia: Inertia;
  refMass: number;
  maxTakeoffMass: number;
  stations: MassStation[];
  tanks: FuelTank[];
  wingArea: number;
  wingSpan: number;
  mac: number;
  surfaces: AeroSurfaceDef[];
  controls: {
    elevatorUp: number; elevatorDown: number; // rad, trailing edge
    aileronUp: number; aileronDown: number;
    rudder: number;
    trimRange: number; // equivalent elevator rad at full trim
    /** Fixed (ground-adjustable) aileron tab rigging, in roll-input units (+ = right). */
    aileronRig: number;
    flapDetents: number[]; // rad
    flapRate: number; // rad/s
    surfaceTau: number; // s, control surface follow time constant
  };
  /**
   * Fuselage body: parasite drag area of the whole airframe (fuselage, gear, struts,
   * cooling), cross-flow areas, and Munk (potential-flow) destabilising volumes in pitch
   * and yaw. The pitch volume also stands in for the propeller normal force.
   */
  fuselage: { pos: Vec3; dragArea: number; sideArea: number; planArea: number; munkVolume: number; munkVolumeYaw: number };
  /** Piston engine + propeller (single-engine props). */
  engine?: PistonEngineDef;
  prop?: PropellerDef;
  propPos?: Vec3;
  /** Prop + crankshaft polar inertia for gyroscopic moments, kg m^2. */
  propInertia?: number;
  /** Fraction of the slipstream velocity increment swirling across the fin. */
  swirl?: number;
  /** Glider: unpowered; the (inert) engine definition is a placeholder and the propulsion block is skipped. */
  glider?: boolean;
  /** Tow/winch hook position, body frame. */
  hook?: Vec3;
  /** Turbofans (jets): definition and thrust point in the body frame. */
  turbofans?: { def: TurbofanDef; pos: Vec3 }[];
  /** Retractable gear: extension time (s) and drag area when down (m^2). */
  retractableGear?: { time: number; dragArea: number };
  /** Tail arm for the downwash lag, m. */
  tailArm: number;
  /** Body angle of attack (deg) at which the stall warning (horn/shaker) triggers. */
  stallWarnAlpha: number;
  /** Pilot eye point in the body frame. */
  eye: Vec3;
  /** Values used when starting a flight in a given configuration. */
  profile: {
    takeoffTrim: number; takeoffFlapLever: number;
    approachKias: number; approachThrottle: number; approachFlapLever: number; approachTrim: number; approachPitchDeg: number;
    cruiseKias: number; cruiseThrottle: number; idleRpm: number; approachRpm: number; cruiseRpm: number;
    /** Clearance radius needed at a parking stand, m. */
    standClearance: number;
  };
  gear: GearDef[];
  contacts: ContactPointDef[];
  /** Points checked against buildings (body frame, datum). */
  hullPoints: Vec3[];
  limits: { vne: number; vno: number; vfe: number; vs0: number; vs1: number; nMax: number; nMin: number };
  /** Datum height above ground when parked (approx, for spawning). */
  spawnHeight: number;
}

export interface Environment {
  atmosphere: AtmosphereConditions;
  /** Air velocity (NED, m/s) at height AGL; includes turbulence. */
  wind: (agl: number) => Vec3;
  /** Vertical air velocity, m/s positive up (thermals, ridge lift); used by gliders. */
  lift?: (north: number, east: number, alt: number, agl: number) => number;
  ground: GroundQuery;
  obstacles?: ObstacleIndex;
}

export interface SurfaceRuntime {
  def: AeroSurfaceDef;
  model: SectionModel;
  chordDir: Vec3;
  normalDir: Vec3;
  spanDir: Vec3;
  deflection: number; // rad (positive = trailing edge toward -normal, i.e. more lift)
  alpha: number;
  cl: number;
  stall: number;
  force: Vec3;
}

export class Aircraft {
  readonly def: AircraftDef;
  pos = new Vec3();
  vel = new Vec3();
  q = new Quat();
  omega = new Vec3();
  mass = 0;
  cg = new Vec3();
  inertia: Inertia;
  surfaces: SurfaceRuntime[];
  engines: EngineModel[];
  get engine(): EngineModel { return this.engines[0]; }
  /** Gear extension 0 (up) .. 1 (down and locked). */
  gearExt = 1;
  /** Spoiler panel extension 0..1. */
  spoiler = 0;
  gearStates: GearState[];
  contactActive: boolean[];
  payload: number[];
  fuel: number[]; // kg per tank
  flap = 0; // rad actual
  elevator = 0; aileronL = 0; aileronR = 0; rudder = 0; // rad actual
  /** Pushback tug: target reverse speed (m/s) or null. The tug pulls on the nose gear with a limited force. */
  /** Winch/tow cable: anchor (world NED), target speed along the cable (m/s), max tension (N), elapsed time (s). */
  cable: { anchor: Vec3; vTarget: number; tMax: number; t: number } | null = null;
  /** Current cable tension, N. */
  cableTension = 0;
  tugSpeed: number | null = null;
  /** Tug steering -1..1 (positive = tug turns right). */
  tugSteer = 0;
  crashed = false;
  crashReason = '';
  events: ContactEvent[] = [];
  time = 0;

  // Derived air data / state (updated every step)
  air: AirState = airAt(0);
  airVelBody = new Vec3();
  tas = 0;
  cas = 0;
  alpha = 0;
  beta = 0;
  mach = 0;
  qbar = 0;
  agl = 0;
  groundElevation = 0;
  /** Specific force (non-gravitational acceleration) in body frame, m/s^2. */
  specificForce = new Vec3(0, 0, -9.81);
  loadFactor = 1;
  wingCL = 0;
  /** Downwash angle at the tail (lagged), rad. */
  downwash = 0;
  onGround = false;
  maxLoadFactor = 1;
  minLoadFactor = 1;
  stallWarning = false;
  fuelStarved = false;

  constructor(def: AircraftDef) {
    this.def = def;
    this.surfaces = def.surfaces.map((s) => {
      const n = s.normal.norm();
      const x = new Vec3(1, 0, 0);
      const chordDir = x.scale(Math.cos(s.incidence)).add(n.scale(Math.sin(s.incidence))).norm();
      const normalDir = n.scale(Math.cos(s.incidence)).sub(x.scale(Math.sin(s.incidence))).norm();
      return {
        def: s, model: new SectionModel(s), chordDir, normalDir, spanDir: chordDir.cross(normalDir),
        deflection: 0, alpha: 0, cl: 0, stall: 0, force: new Vec3(),
      };
    });
    this.engines = def.turbofans ? def.turbofans.map((t) => new TurbofanEngine(t.def)) : [new PistonEngine(def.engine!, def.prop!)];
    this.gearStates = def.gear.map(() => newGearState());
    this.contactActive = def.contacts.map(() => false);
    this.payload = def.stations.map((s) => s.mass);
    this.fuel = def.tanks.map((t) => t.capacity);
    this.inertia = def.refInertia;
    this.updateMass();
  }

  updateMass() {
    const d = this.def;
    let m = d.emptyMass;
    const mom = d.emptyCG.scale(d.emptyMass);
    d.stations.forEach((s, i) => { m += this.payload[i]; mom.addIn(s.pos.scale(this.payload[i])); });
    d.tanks.forEach((t, i) => { m += this.fuel[i]; mom.addIn(t.pos.scale(this.fuel[i])); });
    this.mass = m;
    this.cg = mom.scale(1 / m);
    const k = m / d.refMass;
    this.inertia = new Inertia(d.refInertia.ixx * k, d.refInertia.iyy * k, d.refInertia.izz * k, d.refInertia.ixz * k);
  }

  get euler() { return this.q.toEuler(); }
  /** Altitude MSL of the CG, m. */
  get altitude() { return -this.pos.z; }

  /** Position of a body-frame (datum) point in world NED. */
  worldPoint(p: Vec3) { return this.pos.add(this.q.rotate(p.sub(this.cg))); }

  /**
   * Places the aircraft at rest on its gear at local east/north with true heading (rad).
   * Iterates the static equilibrium using the real gear springs.
   */
  placeOnGround(east: number, north: number, heading: number, env: Environment) {
    this.downwash = 0;
    const h = env.ground.heightAt(east, north);
    this.q = Quat.fromEuler(0, 0, heading);
    this.pos = new Vec3(north, east, -(h + this.def.spawnHeight));
    this.vel = new Vec3();
    this.omega = new Vec3();
    this.crashed = false;
    this.crashReason = '';
    this.gearStates = this.def.gear.map(() => newGearState());
    this.contactActive = this.def.contacts.map(() => false);
    // let it settle on the springs with brakes on, engine untouched
    const ctl = { steer: 0, brakeLeft: 1, brakeRight: 1, parkingBrake: true };
    for (let i = 0; i < 2400; i++) this.settleStep(1 / 240, env, ctl);
    this.vel = new Vec3();
    this.omega = new Vec3();
    this.events = [];
    for (const g of this.gearStates) g.bristle.set(0, 0, 0);
  }

  private settleStep(dt: number, env: Environment, ctl: { steer: number; brakeLeft: number; brakeRight: number; parkingBrake: boolean }) {
    const kin = this.kin();
    const ev: ContactEvent[] = [];
    const g = gearForces(this.def.gear, this.gearStates, kin, env.ground, ctl, dt, ev);
    const F = this.q.rotate(g.force).add(new Vec3(0, 0, this.mass * 9.80665));
    this.vel.addScaled(F, dt / this.mass);
    this.vel = this.vel.scale(0.98); // settling only: artificial damping
    this.pos.addScaled(this.vel, dt);
    const wdot = this.inertia.solve(g.moment.sub(this.omega.cross(this.inertia.mul(this.omega))));
    this.omega.addScaled(wdot, dt);
    this.omega = this.omega.scale(0.98);
    this.q.integrate(this.omega, dt);
  }

  /** Initialise in flight, wings level, at true airspeed (m/s), heading (rad). */
  placeInFlight(east: number, north: number, altMSL: number, heading: number, tas: number, pitch = 0) {
    this.downwash = 0;
    this.q = Quat.fromEuler(0, pitch, heading);
    this.pos = new Vec3(north, east, -altMSL);
    this.vel = this.q.rotate(new Vec3(tas, 0, 0));
    this.omega = new Vec3();
    this.crashed = false;
    this.gearStates = this.def.gear.map(() => newGearState());
    this.contactActive = this.def.contacts.map(() => false);
  }

  private kin(): BodyKinematics {
    return { pos: this.pos, vel: this.vel, q: this.q, omega: this.omega, cg: this.cg };
  }

  /**
   * Advance the simulation by dt seconds. `fuelAvailable` and `busPowered` come from the
   * fuel and electrical systems (busPowered drives the starter and the electric flaps).
   */
  step(dt: number, c: FlightControls, env: Environment, fuelAvailable: boolean, busPowered: boolean) {
    if (this.crashed) return;
    const d = this.def;
    this.time += dt;

    // --- Control surfaces follow the pilot's inputs (cable-driven, slightly lagged)
    const cl = d.controls;
    const pitchCmd = clamp(c.pitch, -1, 1);
    const elevStick = pitchCmd >= 0 ? -cl.elevatorUp * pitchCmd : -cl.elevatorDown * pitchCmd;
    const elevTarget = clamp(elevStick - c.trim * cl.trimRange, -cl.elevatorUp, cl.elevatorDown);
    const r = clamp(c.roll + cl.aileronRig, -1, 1);
    const ailRTarget = r >= 0 ? -cl.aileronUp * r : -cl.aileronDown * r;
    const ailLTarget = r >= 0 ? cl.aileronDown * r : cl.aileronUp * r;
    const rudTarget = -cl.rudder * clamp(c.yaw, -1, 1);
    this.elevator = approach(this.elevator, elevTarget, cl.surfaceTau, dt);
    this.aileronL = approach(this.aileronL, ailLTarget, cl.surfaceTau, dt);
    this.aileronR = approach(this.aileronR, ailRTarget, cl.surfaceTau, dt);
    this.rudder = approach(this.rudder, rudTarget, cl.surfaceTau, dt);
    const flapTarget = cl.flapDetents[clamp(Math.round(c.flapLever), 0, cl.flapDetents.length - 1)];
    // Electric / hydraulic flap drive needs power
    if (busPowered) this.flap = moveToward(this.flap, flapTarget, cl.flapRate * dt);
    if (d.retractableGear) {
      // gear cannot retract with weight on wheels (squat switch)
      const want = c.gearDown || this.onGround ? 1 : 0;
      if (busPowered) this.gearExt = moveToward(this.gearExt, want, dt / d.retractableGear.time);
    }
    this.spoiler = moveToward(this.spoiler, clamp(c.speedbrake, 0, 1), dt / 1.5);

    // --- Air data
    this.groundElevation = env.ground.heightAt(this.pos.y, this.pos.x);
    this.agl = this.altitude - this.groundElevation;
    airAt(this.altitude, env.atmosphere, this.air);
    let wind = env.wind(this.agl);
    if (this.def.glider && env.lift) wind = wind.add(new Vec3(0, 0, -env.lift(this.pos.x, this.pos.y, this.altitude, this.agl)));
    const vAirWorld = this.vel.sub(wind);
    const vb = this.q.invRotate(vAirWorld);
    this.airVelBody = vb;
    this.tas = vb.len();
    this.alpha = Math.atan2(vb.z, vb.x);
    this.beta = this.tas > 0.5 ? Math.asin(clamp(vb.y / this.tas, -1, 1)) : 0;
    this.mach = this.tas / this.air.speedOfSound;
    this.qbar = 0.5 * this.air.density * this.tas * this.tas;
    this.cas = casFromImpactPressure(impactPressure(Math.max(0, vb.x), this.air));

    // --- Propulsion
    const F = new Vec3();
    const M = new Vec3();
    const rho = this.air.density;
    this.fuelStarved = !fuelAvailable;
    const engIn = { throttle: c.throttle, mixture: c.mixture, mags: c.mags, starterPower: busPowered, fuelAvailable, reverse: c.reverse, onGround: this.onGround };
    if (d.glider) {
      // unpowered
    } else if (d.turbofans) {
      d.turbofans.forEach((t, i) => {
        const e = this.engines[i];
        e.step(dt, engIn, this.air, vb.x);
        const th = new Vec3(e.thrust, 0, 0);
        F.addIn(th);
        M.addIn(t.pos.sub(this.cg).cross(th));
      });
    } else {
      const e = this.engines[0] as PistonEngine;
      e.step(dt, engIn, this.air, vb.x);
      // Thrust along body x at the propeller hub; torque reaction rolls left (clockwise prop)
      const rProp = d.propPos!.sub(this.cg);
      const thrust = new Vec3(e.thrust, 0, 0);
      F.addIn(thrust);
      M.addIn(rProp.cross(thrust));
      M.x -= e.propTorque;
      // P-factor: descending (right) blade sees more AoA at positive alpha -> yaw left
      M.z -= e.thrust * 0.1 * (d.prop!.diameter / 2) * clamp(this.alpha, -0.4, 0.4);
      // Gyroscopic precession of the propeller
      const omegaProp = (e.rpm * 2 * Math.PI) / 60;
      const H = new Vec3(d.propInertia! * omegaProp, 0, 0);
      M.addIn(this.omega.cross(H).neg());
    }

    // --- Lifting surfaces
    const wingAgl = this.agl; // CG height is close enough to the wing for ground effect
    let wingLift = 0;
    const slipV = this.engines[0].slipstreamDeltaV;
    const tailArm = d.tailArm;
    const lagTau = tailArm / Math.max(this.tas, 10);
    for (const s of this.surfaces) {
      const sd = s.def;
      s.deflection = sd.channel === 'aileronL' ? this.aileronL : sd.channel === 'aileronR' ? this.aileronR
        : sd.channel === 'elevator' ? this.elevator : sd.channel === 'rudder' ? this.rudder
          : sd.channel === 'flap' ? this.flap : 0;
      const r = sd.pos.sub(this.cg);
      const vloc = vb.add(this.omega.cross(r));
      if (sd.slipstream > 0) {
        vloc.x += slipV * sd.slipstream;
        if (sd.role === 'vtail') vloc.y -= slipV * (d.swirl ?? 0);
      }
      const vc = vloc.dot(s.chordDir);
      const vn = vloc.dot(s.normalDir);
      const V2 = vc * vc + vn * vn;
      if (V2 < 0.25) { s.force = new Vec3(); s.alpha = 0; s.cl = 0; s.stall = 0; continue; }
      const V = Math.sqrt(V2);
      let alpha = Math.atan2(-vn, vc);
      const ge = groundEffectFactor(wingAgl, sd.span);
      if (sd.downwash) alpha -= this.downwash * ge;
      const slat = sd.slatClMax && this.flap > 0.01 ? sd.slatClMax * Math.min(1, this.flap / (5 * DEG)) : 0;
      let [clv, cdp, cm, stall] = s.model.coeffs(alpha, s.deflection, slat);
      if (sd.spoiler && this.spoiler > 0) { clv *= 1 - 0.6 * this.spoiler; cdp += (sd.spoilerCd ?? 0.08) * this.spoiler; }
      // ground effect also increases the effective lift slope slightly
      const clEff = clv * (1 + 0.12 * (1 - ge) * (sd.role === 'wing' ? 1 : 0));
      const cdi = (clEff * clEff) / (Math.PI * sd.oswald * sd.aspectRatio) * ge;
      const q = 0.5 * rho * V2;
      const mDir = s.chordDir.scale(vc / V).add(s.normalDir.scale(vn / V));
      const lDir = s.normalDir.scale(vc / V).sub(s.chordDir.scale(vn / V));
      const f = lDir.scale(q * sd.area * clEff).add(mDir.scale(-q * sd.area * (cdp + cdi)));
      F.addIn(f);
      M.addIn(r.cross(f));
      M.addIn(s.spanDir.scale(q * sd.area * sd.chord * cm));
      s.alpha = alpha; s.cl = clEff; s.stall = stall; s.force = f;
      if (sd.role === 'wing') wingLift += f.dot(s.normalDir);
    }
    const qInf = Math.max(this.qbar, 1);
    this.wingCL = wingLift / (qInf * d.wingArea);
    const AR = (d.wingSpan * d.wingSpan) / d.wingArea;
    const epsTarget = (2 * this.wingCL) / (Math.PI * AR * 0.85);
    this.downwash = approach(this.downwash, clamp(epsTarget, -0.3, 0.3), lagTau, dt);

    // --- Fuselage, gear legs, struts: parasite drag, cross-flow drag, Munk moment
    const fu = d.fuselage;
    if (this.tas > 0.5) {
      const rF = fu.pos.sub(this.cg);
      const dir = vb.scale(1 / this.tas);
      const gearDrag = d.retractableGear ? d.retractableGear.dragArea * this.gearExt : 0;
      const fd = dir.scale(-this.qbar * (fu.dragArea + gearDrag));
      const fcf = new Vec3(0, -0.5 * rho * fu.sideArea * 1.2 * vb.y * Math.abs(vb.y), -0.5 * rho * fu.planArea * 1.2 * vb.z * Math.abs(vb.z));
      const ff = fd.add(fcf);
      F.addIn(ff);
      M.addIn(rF.cross(ff));
      const ca = Math.cos(this.alpha), cb = Math.cos(this.beta);
      M.y += this.qbar * 2 * fu.munkVolume * Math.sin(this.alpha) * ca * cb;
      M.z -= this.qbar * 2 * fu.munkVolumeYaw * Math.sin(this.beta) * cb;
    }

    // Winch cable: tension (limited, speed-controlled like a winch driver) along the line from the hook to the winch.
    this.cableTension = 0;
    if (this.cable && d.hook) {
      const hw = this.worldPoint(d.hook);
      const dv = this.cable.anchor.sub(hw);
      const dist = Math.max(1, dv.len());
      const dir = dv.scale(1 / dist);
      const closing = this.vel.dot(dir);
      this.cable.t += dt;
      const target = this.cable.vTarget * Math.min(1, this.cable.t / 3);
      // the winch driver backs off above ~60 kt airspeed (weak-link / over-speed protection)
      const T = this.cable.tMax * clamp((target - closing) / 4, 0, 1) * clamp((70 - this.cas / 0.514444) / 10, 0, 1);
      this.cableTension = T;
      const fb = this.q.invRotate(dir.scale(T));
      F.addIn(fb);
      M.addIn(d.hook.sub(this.cg).cross(fb));
    }

    // Pushback tug: speed-controlled horizontal force at the nose gear (max 90 kN) along the towbar.
    // Steering swings the towbar up to 35 deg; steer > 0 = tug turns right = nose gear pulled to the aircraft's left.
    if (this.tugSpeed !== null && this.onGround) {
      const phi = this.tugSteer * 35 * DEG;
      const dx = -Math.cos(phi), dy = -Math.sin(phi);
      const vb = this.q.invRotate(this.vel);
      const fmag = Math.max(-90000, Math.min(90000, 80000 * (this.tugSpeed - (vb.x * dx + vb.y * dy))));
      const tf = new Vec3(fmag * dx, fmag * dy, 0);
      F.addIn(tf);
      M.addIn(d.gear[0].attach.cross(tf));
    }

    // Flight (aerodynamic + thrust) load factor, for structural limits. Ground reactions
    // are judged separately (gear sink rate, contact impact speed).
    const flightNz = -F.z / (this.mass * 9.80665);

    // --- Ground contact
    const kin = this.kin();
    const ev: ContactEvent[] = [];
    const steer = c.yaw;
    if (this.gearExt > 0.98) {
      const gf = gearForces(d.gear, this.gearStates, kin, env.ground,
        { steer, brakeLeft: c.brakeLeft, brakeRight: c.brakeRight, parkingBrake: c.parkingBrake }, dt, ev);
      F.addIn(gf.force); M.addIn(gf.moment);
    } else {
      for (const g of this.gearStates) { g.contact = false; g.force = 0; g.compression = 0; g.lateralForce = 0; }
    }
    const cf = contactPointForces(d.contacts, this.contactActive, kin, env.ground, this.engine.rpm > 150, ev);
    F.addIn(cf.force); M.addIn(cf.moment);
    this.onGround = this.gearStates.some((g) => g.contact);

    // Buildings
    if (env.obstacles) {
      for (const p of d.hullPoints) {
        const w = this.worldPoint(p);
        const id = env.obstacles.hit(w.y, w.x, -w.z);
        if (id >= 0) {
          ev.push({ name: `building #${id}`, kind: 'building', impactSpeed: this.vel.len(), fatal: true });
          break;
        }
      }
    }

    // Water: touching water with the gear is a ditching
    for (let i = 0; i < this.gearStates.length; i++) {
      if (this.gearStates[i].contact && this.gearStates[i].surface === 'water' && this.vel.len() > 2) {
        ev.push({ name: d.gear[i].name, kind: 'gear', impactSpeed: this.vel.len(), fatal: true });
      }
    }

    // --- Integrate rigid body (semi-implicit Euler)
    this.specificForce = F.scale(1 / this.mass);
    this.loadFactor = -this.specificForce.z / 9.80665;
    if (this.tas > 20) {
      this.maxLoadFactor = Math.max(this.maxLoadFactor, flightNz);
      this.minLoadFactor = Math.min(this.minLoadFactor, flightNz);
    }
    const Fw = this.q.rotate(F).add(new Vec3(0, 0, this.mass * 9.80665));
    this.vel.addScaled(Fw, dt / this.mass);
    this.pos.addScaled(this.vel, dt);
    const Iw = this.inertia.mul(this.omega);
    const wdot = this.inertia.solve(M.sub(this.omega.cross(Iw)));
    this.omega.addScaled(wdot, dt);
    this.q.integrate(this.omega, dt);

    // Stall warning vane: triggers ~5-10 kt above the stall (local AoA near wing root)
    this.stallWarning = this.tas > 15 && !this.onGround && this.alpha / DEG > d.stallWarnAlpha - 0.15 * (this.flap / DEG);

    // --- Damage / crash detection
    for (const e of ev) {
      this.events.push(e);
      if (e.fatal && !this.crashed) {
        this.crashed = true;
        this.crashReason = e.kind === 'building' ? `Collision with ${e.name}`
          : e.kind === 'prop' ? 'Propeller strike'
            : e.kind === 'gear' ? (this.gearStates.some((g) => g.surface === 'water') ? 'Ditched in water' : `Hard landing: ${e.name} gear failed (${(e.impactSpeed * 196.85).toFixed(0)} fpm)`)
              : `Impact: ${e.name} (${(e.impactSpeed * 196.85).toFixed(0)} fpm)`;
      }
    }
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
    if (this.crashed) { this.vel = new Vec3(); this.omega = new Vec3(); }
  }
}
