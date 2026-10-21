// Crash and collision detection against real EGPH terrain and buildings.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, flatWorld, newSim, run, CALM_ISA, LandingPilot, TestPilot } from './helpers';
import { World } from '../src/world/world';
import { Vec3, KT, FT, DEG, clamp } from '../src/core/math';
import { runwayEnd } from '../src/world/airport';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

describe('crash and collision detection', () => {
  it('a steep dive into the ground is detected as a crash', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    sim.aircraft.placeInFlight(0, 1000, 150, 0, 100 * KT, -30 * DEG);
    run(sim, 30);
    expect(sim.aircraft.crashed).toBe(true);
    expect(sim.aircraft.altitude).toBeGreaterThan(-3); // stopped at the surface, not below it
  });

  it('a 1000 fpm arrival breaks the gear; a 150 fpm one does not', () => {
    for (const [fpm, expectCrash] of [[1000, true], [150, false]] as const) {
      const sim = newSim(flatWorld(0));
      sim.spawn({ kind: 'runway', ident: '36' });
      const ac = sim.aircraft;
      // main wheels ~0.5 m above the runway in a landing attitude
      ac.placeInFlight(0, 500, 1.6, 0, 55 * KT, 6 * DEG);
      ac.vel = new Vec3(55 * KT, 0, (fpm * FT) / 60);
      sim.controls.throttle = 0;
      // hold the landing attitude (nose wheel off) as a pilot would
      run(sim, 5, () => { sim.controls.pitch = clamp(4 * (6 * DEG - ac.euler[1]) - ac.omega.y, -1, 1); });
      expect(ac.crashed, `${fpm} fpm: ${ac.crashReason}`).toBe(expectCrash);
      if (expectCrash) expect(ac.crashReason).toMatch(/gear|Hard landing|Impact|Propeller/);
    }
  });

  it('a wingtip strike during a steeply banked low pass is a crash', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft;
    ac.placeInFlight(0, 500, 4.0, 0, 70 * KT, 0);
    ac.q = (ac.q.constructor as any).fromEuler(-60 * DEG, 0, 0);
    ac.vel = new Vec3(70 * KT, 0, 1.0);
    run(sim, 3);
    expect(ac.crashed).toBe(true);
    expect(ac.crashReason).toMatch(/wingtip|Impact/i);
  });

  it('flying into an EGPH terminal building is detected', () => {
    const sim = newSim(world, CALM_ISA);
    sim.spawn({ kind: 'runway', ident: '24' });
    // pick the tallest building in the airport set and fly at it from 400 m at mid-height
    const ob = world.obstacles;
    let best = -1, bestH = 0;
    for (const id of ob.query(-1500, -1500, 1500, 1500)) {
      const b = ob.buildings[id];
      const h = b.top - b.base;
      if (h > bestH && h < 40 && (b.maxE - b.minE) > 30) { best = id; bestH = h; }
    }
    expect(best).toBeGreaterThanOrEqual(0);
    const b = ob.buildings[best];
    const ce = (b.minE + b.maxE) / 2, cn = (b.minN + b.maxN) / 2;
    const ac = sim.aircraft;
    expect(bestH).toBeGreaterThan(10);
    const alt = b.base + (b.top - b.base) * 0.7;
    ac.placeInFlight(ce - 400, cn, alt, 90 * DEG, 90 * KT, 0); // heading east toward it
    sim.controls.throttle = 0.7;
    const p = new TestPilot(sim);
    run(sim, 20, () => { p.holdAltitudeWithPitch(alt); p.wingsLevel(90 * DEG); });
    expect(ac.crashed).toBe(true);
    expect(ac.crashReason).toMatch(/building/i);
  });

  it('ditching in the Firth of Forth is detected (with land cover)', () => {
    // The headless world has no land-cover raster, so emulate it: water north of y=8 km
    const sim = newSim(world, CALM_ISA);
    const lcWorld = Object.create(world);
    lcWorld.surfaceAt = (e: number, n: number) => (n > 8000 ? { friction: 0.05, rolling: 0.5, kind: 'water' } : world.surfaceAt(e, n));
    sim.env.ground = lcWorld;
    sim.spawn({ kind: 'runway', ident: '24' });
    const ac = sim.aircraft;
    ac.placeInFlight(3000, 9000, world.heightAt(3000, 9000) + 3, 0, 55 * KT, 4 * DEG);
    sim.controls.throttle = 0;
    run(sim, 20, () => { sim.controls.pitch = 0.2; });
    expect(ac.crashed).toBe(true);
    expect(ac.crashReason).toMatch(/water|Ditch/i);
  });

  it('a normal landing on EGPH runway 06 from a 3 nm final is not a crash and stays on the runway', () => {
    const sim = newSim(world, CALM_ISA);
    sim.spawn({ kind: 'approach', ident: '06', distanceNm: 3 });
    sim.controls.flapLever = 3;
    const { end } = runwayEnd(world.airport, '06');
    const lp = new LandingPilot(sim, end.x, end.y, end.hdgTrue * DEG, end.elev, 63, end.displaced + 300);
    run(sim, 400, () => { lp.step(); if (lp.phase === 'stopped') return true; });
    const ac = sim.aircraft;
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(lp.phase).toBe('stopped');
    const { cross, along } = lp.track();
    expect(Math.abs(cross)).toBeLessThan(15);
    expect(along).toBeGreaterThan(end.displaced);
    expect(along).toBeLessThan(2556);
    expect(world.surfaceAt(ac.pos.y, ac.pos.x).kind).toBe('asphalt');
    console.log(`EGPH 06 landing: touchdown ${lp.touchdown!.kias.toFixed(0)} KIAS ${lp.touchdown!.sinkFpm.toFixed(0)} fpm; stopped ${along.toFixed(0)} m past threshold, ${cross.toFixed(1)} m off centreline`);
  });
});
