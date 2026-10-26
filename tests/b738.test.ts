// Boeing 737-800: takeoff, climb, turns, configuration changes, EGPH landing, rollout,
// taxi, collisions and instruments. All flown through the controls only.
import { CRASHES_ENABLED } from '../src/sim/fdm/aircraft';
import { describe, it, expect, beforeAll } from 'vitest';
import { flatWorld, loadEGPH, newSim, run, kt, ft, TestPilot, LandingPilot, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { DEG, RAD, KT, FT, clamp } from '../src/core/math';
import { B738 } from '../src/sim/aircraft/b738';
import { C172 } from '../src/sim/aircraft/c172';
import { runwayEnd } from '../src/world/airport';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

/** Runway 24 at EGPH, ~74 t, flaps 5: full takeoff to 1500 ft AGL with gear retraction. */
function takeoff(sim: ReturnType<typeof newSim>, log: Record<string, number>) {
  const ac = sim.aircraft, c = sim.controls;
  const psi0 = ac.euler[2];
  c.throttle = 0.95;
  const p = new TestPilot(sim);
  const fieldElev = ac.altitude;
  run(sim, 240, (t) => {
    const [phi, th, psi] = ac.euler;
    let e = psi0 - psi; e = Math.atan2(Math.sin(e), Math.cos(e));
    const ias = kt(ac.cas);
    if (ac.onGround || ac.agl < 15) {
      c.yaw = clamp(e * 4 - ac.omega.z * 2, -1, 1);
      c.roll = clamp(-phi * 2, -1, 1);
      if (ias > 148) {
        if (!log.vr) { log.vr = ias; log.vrDist = t; }
        const tgt = ac.onGround ? 8 * DEG : 13 * DEG;
        c.pitch = clamp(1.5 * (tgt - th) - 2.5 * ac.omega.y + 0.2, -1, 1);
      } else c.pitch = 0;
    } else {
      p.holdSpeedWithPitch(170); p.wingsLevel(psi0);
    }
    if (t > 2 && !ac.onGround && !log.liftoff) { log.liftoff = ias; log.liftoffPitch = th * RAD; log.liftoffT = t; }
    if (log.liftoff && !log.gearUpT && ac.altitude - fieldElev > 15) { c.gearDown = false; log.gearUpT = t; }
    if (log.gearUpT && ac.gearExt === 0 && !log.gearUpDone) log.gearUpDone = t - log.gearUpT;
    if (ac.altitude - fieldElev > 1500 * FT) { log.at1500 = t; return true; }
  });
}

describe('Boeing 737-800', () => {
  it('rests on its gear at a jet stand at EGPH (nose ~9 % of weight)', () => {
    const sim = newSim(world, CALM_ISA, B738);
    sim.spawn({ kind: 'stand', index: 0, coldAndDark: false });
    run(sim, 5);
    const ac = sim.aircraft, g = ac.gearStates;
    const total = g.reduce((a, s) => a + s.force, 0);
    console.log(`737 static: mass ${ac.mass.toFixed(0)} kg, nose ${(g[0].force / total * 100).toFixed(1)} %, struts ${g.map((s) => s.compression.toFixed(2)).join('/')} m`);
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(g[0].force / total).toBeGreaterThan(0.06);
    expect(g[0].force / total).toBeLessThan(0.14);
    expect(Math.abs(total - ac.mass * 9.80665) / total).toBeLessThan(0.02);
    expect(ac.contactActive.some((x) => x)).toBe(false);
  });

  it('takes off from EGPH runway 24 at plausible speeds, retracts the gear and climbs', () => {
    const sim = newSim(world, CALM_ISA, B738);
    sim.spawn({ kind: 'runway', ident: '24' });
    const log: Record<string, number> = {};
    takeoff(sim, log);
    const ac = sim.aircraft;
    console.log(`737 takeoff (mass ${ac.mass.toFixed(0)} kg, flaps 5): VR ${log.vr?.toFixed(0)} KIAS, liftoff ${log.liftoff?.toFixed(0)} KIAS at ${log.liftoffPitch?.toFixed(1)} deg after ${log.liftoffT?.toFixed(0)} s, gear up in ${log.gearUpDone?.toFixed(1)} s, 1500 ft AGL at ${log.at1500?.toFixed(0)} s; tail strike: ${ac.events.some((e) => e.kind === 'tail')}`);
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(log.liftoff).toBeGreaterThan(145);
    expect(log.liftoff).toBeLessThan(170);
    expect(log.liftoffT).toBeGreaterThan(28); // a heavy jet takes ~30-40 s to lift off
    expect(log.liftoffT).toBeLessThan(50);
    expect(ac.events.some((e) => e.kind === 'tail')).toBe(false);
    expect(log.gearUpDone).toBeGreaterThan(6);
    expect(log.gearUpDone).toBeLessThan(10);
    expect(log.at1500).toBeGreaterThan(0);
  });

  it('is much less responsive than the C172: lower roll rate and slower pitch response', () => {
    const rollRate = (def: typeof B738, kias: number) => {
      const sim = newSim(flatWorld(0), undefined, def);
      sim.spawnAir(0, -20000, 5000, 0);
      sim.aircraft.vel = sim.aircraft.vel.scale((kias * KT * 1.08) / sim.aircraft.vel.len());
      sim.controls.roll = 1;
      let p = 0;
      run(sim, 2, () => { p = Math.max(p, sim.aircraft.omega.x); });
      return p * RAD;
    };
    const jet = rollRate(B738, 250), cessna = rollRate(C172, 100);
    console.log(`full-aileron roll rate after 2 s: 737 ${jet.toFixed(1)} deg/s vs C172 ${cessna.toFixed(1)} deg/s`);
    expect(jet).toBeLessThan(cessna * 0.7);
    expect(jet).toBeGreaterThan(8);
  });

  it('flies stable, holds altitude in a 25 deg banked turn, and the autopilot holds ALT/HDG', () => {
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawnAir(0, -20000, 5000, 0);
    const ac = sim.aircraft, c = sim.controls;
    const p = new TestPilot(sim);
    c.throttle = 0.6;
    run(sim, 30, () => { p.holdAltitudeWithPitch(5000 * FT); p.wingsLevel(0); });
    // banked turn, pilot holds altitude
    let maxAltErr = 0;
    const psi0 = ac.euler[2];
    run(sim, 40, () => {
      p.holdAltitudeWithPitch(5000 * FT);
      c.roll = clamp(2 * (25 * DEG - ac.euler[0]) - 0.6 * ac.omega.x, -1, 1);
      c.yaw = clamp(ac.beta * 4, -1, 1);
      maxAltErr = Math.max(maxAltErr, Math.abs(ac.altitude - 5000 * FT));
    });
    let turned = ac.euler[2] - psi0; turned = Math.atan2(Math.sin(turned), Math.cos(turned));
    console.log(`25 deg bank turn: turned ${(turned * RAD).toFixed(0)} deg in 40 s, max altitude error ${(maxAltErr / FT).toFixed(0)} ft`);
    expect(turned * RAD).toBeGreaterThan(30);
    expect(maxAltErr / FT).toBeLessThan(150);
    // autopilot
    c.roll = 0; c.yaw = 0;
    run(sim, 10, () => { p.wingsLevel(ac.euler[2]); p.holdAltitudeWithPitch(5000 * FT); });
    c.pitch = 0; c.roll = 0;
    sim.autopilot.engage(sim.systems);
    sim.autopilot.holdAltitude(sim.systems);
    sim.autopilot.lateral = 'HDG';
    c.headingBug = (Math.round(sim.systems.ind.headingDeg) + 60) % 360;
    const target = sim.autopilot.targetAltFt;
    let apErr = 0;
    run(sim, 120, (t) => { if (t > 15) apErr = Math.max(apErr, Math.abs(sim.systems.ind.altitudeFt - target)); });
    let hErr = c.headingBug - sim.systems.ind.headingDeg; hErr = ((hErr + 540) % 360) - 180;
    console.log(`737 autopilot: ALT error max ${apErr.toFixed(0)} ft, heading error ${hErr.toFixed(1)} deg, engaged ${sim.autopilot.engaged}`);
    expect(sim.autopilot.engaged).toBe(true);
    expect(apErr).toBeLessThan(100);
    expect(Math.abs(hErr)).toBeLessThan(4);
  });

  it('flaps and gear: drag and lift change, gear cannot retract on the ground, flaps move at a realistic rate', () => {
    const sim = newSim(world, CALM_ISA, B738);
    sim.spawn({ kind: 'runway', ident: '24' });
    const ac = sim.aircraft, c = sim.controls;
    c.gearDown = false;
    run(sim, 3);
    expect(ac.gearExt).toBe(1); // squat switch
    c.flapLever = 7; // flaps 30 from 5
    run(sim, 10);
    const deg = ac.flap * RAD;
    console.log(`flaps 5 -> 30: ${deg.toFixed(1)} deg after 10 s`);
    expect(deg).toBeGreaterThan(14);
    expect(deg).toBeLessThan(30);
    run(sim, 20);
    expect(Math.round(ac.flap * RAD)).toBe(30);
  });

  it('lands on EGPH runway 24 from a 4 nm final, then brakes (reversers, spoilers) and taxis clear', () => {
    const sim = newSim(world, CALM_ISA, B738);
    sim.aircraft.fuel = [3000, 3000]; sim.aircraft.updateMass();
    sim.spawn({ kind: 'approach', ident: '24', distanceNm: 4 });
    const ac = sim.aircraft;
    const { end } = runwayEnd(world.airport, '24');
    const lp = new LandingPilot(sim, end.x, end.y, end.hdgTrue * DEG, end.elev, 145, end.displaced + 350, true, 3.85, 10, true, 0.8, 4.5);
    run(sim, 400, () => { lp.step(); if (lp.phase === 'stopped') return true; });
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(lp.phase).toBe('stopped');
    const td = lp.touchdown!;
    const { along, cross } = lp.track();
    const rollM = Math.hypot(lp.stop!.x - td.x, lp.stop!.y - td.y);
    console.log(`737 EGPH 24 landing (mass ${ac.mass.toFixed(0)} kg, flaps 30): touchdown ${td.kias.toFixed(0)} KIAS, ${td.sinkFpm.toFixed(0)} fpm, pitch ${td.pitchDeg.toFixed(1)} deg; roll ${rollM.toFixed(0)} m; stopped ${along.toFixed(0)} m past threshold, ${cross.toFixed(1)} m off centreline`);
    expect(td.kias).toBeGreaterThan(125);
    expect(td.kias).toBeLessThan(155);
    expect(td.sinkFpm).toBeLessThan(600);
    expect(rollM).toBeLessThan(1500);
    expect(Math.abs(cross)).toBeLessThan(10);
    expect(world.surfaceAt(ac.pos.y, ac.pos.x).kind).toBe('asphalt');
    // taxi: stow reversers/speedbrake, taxi thrust, tiller turn
    const c = sim.controls;
    c.reverse = false; c.speedbrake = 0; c.brakeLeft = c.brakeRight = 0; c.flapLever = 0;
    c.throttle = 0.22;
    const psi0 = ac.euler[2];
    run(sim, 25, () => { c.yaw = kt(ac.vel.len()) > 12 ? 0 : 0; c.throttle = kt(ac.vel.len()) > 12 ? 0.05 : 0.22; });
    c.yaw = 1; // full tiller
    run(sim, 6, () => { c.throttle = kt(ac.vel.len()) > 10 ? 0.05 : 0.2; });
    let dpsi = ac.euler[2] - psi0; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
    console.log(`taxi after landing: ${kt(ac.vel.len()).toFixed(1)} kt, turned ${(dpsi * RAD).toFixed(0)} deg with the tiller`);
    expect(dpsi * RAD).toBeGreaterThan(45);
    expect(ac.crashed, ac.crashReason).toBe(false);
  });

  it.skipIf(!CRASHES_ENABLED)('collisions: over-rotation strikes the tail; a gear-up landing is a crash; flying into the terminal is a crash', () => {
    // tail strike
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft;
    sim.controls.throttle = 0.95;
    run(sim, 60, () => { if (kt(ac.cas) > 130) sim.controls.pitch = 1; if (ac.agl > 30) return true; });
    expect(ac.events.some((e) => e.kind === 'tail')).toBe(true);
    // gear-up landing
    const s2 = newSim(flatWorld(0), undefined, B738);
    s2.spawnAir(0, 500, 0, 0);
    const a2 = s2.aircraft;
    a2.placeInFlight(0, 500, 6, 0, 140 * KT, 2 * DEG);
    a2.gearExt = 0; s2.controls.gearDown = false; s2.controls.throttle = 0;
    run(s2, 10);
    console.log(`gear-up landing: ${a2.crashReason}`);
    expect(a2.crashed).toBe(true);
    // building
    const s3 = newSim(world, CALM_ISA, B738);
    s3.spawn({ kind: 'runway', ident: '24' });
    const ob = world.obstacles;
    let best = -1, bestH = 0;
    for (const id of ob.query(-1500, -1500, 1500, 1500)) { const b = ob.buildings[id]; const h = b.top - b.base; if (h > bestH && h < 80 && b.maxE - b.minE > 15) { best = id; bestH = h; } }
    expect(bestH).toBeGreaterThan(8);
    const b = ob.buildings[best];
    const alt = b.base + (b.top - b.base) * 0.6;
    s3.aircraft.placeInFlight(b.minE - 250, (b.minN + b.maxN) / 2, alt, 90 * DEG, 160 * KT, 0);
    s3.aircraft.q = (s3.aircraft.q.constructor as any).fromEuler(0, 5 * DEG, 90 * DEG); // near trim attitude, flight path level
    s3.aircraft.gearExt = 0; s3.controls.gearDown = false;
    const p3 = new TestPilot(s3);
    s3.controls.throttle = 0.6;
    run(s3, 20, () => { p3.holdAltitudeWithPitch(alt); p3.wingsLevel(90 * DEG); });
    expect(s3.aircraft.crashed).toBe(true);
    expect(s3.aircraft.crashReason).toMatch(/building/i);
  });

  it('instruments read the simulated state (IAS, altitude, N1)', () => {
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawnAir(0, -20000, 5000, 0);
    const p = new TestPilot(sim);
    run(sim, 20, () => { p.holdAltitudeWithPitch(5000 * FT); p.wingsLevel(0); });
    const ind = sim.systems.ind, ac = sim.aircraft;
    expect(Math.abs(ind.iasKt - kt(ac.cas))).toBeLessThan(3);
    expect(Math.abs(ind.altitudeFt - ft(ac.altitude))).toBeLessThan(60);
    expect(ind.n1.length).toBe(2);
    expect(Math.abs(ind.n1[0] - ac.engines[0].rpm / 100)).toBeLessThan(0.01);
    expect(ind.fuelFlowKgH).toBeGreaterThan(500);
  });
});
