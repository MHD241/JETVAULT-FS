// Scotland world: one coordinate frame, three detailed airports inside a regional terrain grid.
import { describe, it, expect } from 'vitest';
import { loadEGPH, newSim, run } from './helpers';
import { GLIDER } from '../src/sim/aircraft/glider';
import { B738 } from '../src/sim/aircraft/b738';
import { KT } from '../src/core/math';
import { clamp } from '../src/core/math';
import { DEFAULT_WEATHER } from '../src/sim/weather';

describe('Scotland world', async () => {
  const world = await loadEGPH('all');
  it('has three airports with ground data and patches inside the regional grid', () => {
    expect(world.airports.map((a) => a.icao)).toEqual(['EGPH', 'EGPF', 'EGPM']);
    expect(world.terrain.patches.length).toBe(3);
    const lo = world.terrain.lo!;
    expect(lo.half).toBe(400000);
    // a point in the Highlands comes from the regional grid and is high
    expect(world.terrain.heightAt(-100000, 95000)).toBeGreaterThan(500);
    // each airport's threshold height comes from its own patch and matches the published elevation roughly
    for (const a of world.airports) {
      const e = a.runways[0].ends[0];
      const h = world.terrain.heightAt(e.x, e.y);
      expect(Math.abs(h - e.elev), a.icao).toBeLessThan(15);
    }
  });
  it('streams patches in and out: unloading drops the patch terrain and its buildings, reloading restores them', async () => {
    const e = world.airports[1].runways[0].ends[0]; // Glasgow threshold
    const h0 = world.terrain.heightAt(e.x, e.y);
    const nb = world.obstacles.buildings.length;
    world.unloadPatch('egpf');
    expect(world.terrain.hasPatch('egpf')).toBe(false);
    expect(world.obstacles.buildings.length).toBeLessThan(nb);
    const coarse = world.terrain.heightAt(e.x, e.y); // regional 500 m grid only
    expect(Number.isFinite(coarse)).toBe(true);
    await world.loadPatch('egpf');
    expect(world.terrain.hasPatch('egpf')).toBe(true);
    expect(world.obstacles.buildings.length).toBe(nb);
    expect(world.terrain.heightAt(e.x, e.y)).toBeCloseTo(h0, 3);
  });
  it('lands a 737 on Glasgow 23 area: spawns on the runway and stays on the asphalt', () => {
    world.setAirport('EGPF');
    const sim = newSim(world, { ...DEFAULT_WEATHER, windSpeed: 0, turbulence: 0 }, B738);
    sim.spawn({ kind: 'runway', ident: '23' });
    run(sim, 5, () => { sim.controls.parkingBrake = true; });
    const ac = sim.aircraft;
    expect(ac.onGround).toBe(true);
    expect(ac.crashed).toBe(false);
    expect(world.surfaceAt(ac.pos.y, ac.pos.x).kind).toBe('asphalt');
    world.setAirport('EGPH');
  });
  it('Portmoak winch launch works on the grass', () => {
    world.setAirport('EGPM');
    const sim = newSim(world, { ...DEFAULT_WEATHER, windSpeed: 0, turbulence: 0, timeOfDay: 2 }, GLIDER);
    sim.spawn({ kind: 'runway', ident: '10' });
    const ac = sim.aircraft;
    run(sim, 3, () => {});
    expect(world.surfaceAt(ac.pos.y, ac.pos.x).kind).toBe('grass');
    expect(sim.startWinch()).toBe(true);
    let maxAgl = 0;
    run(sim, 45, () => {
      sim.controls.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5);
      const target = !ac.cable ? 0 : ac.agl > 8 ? 14 * Math.PI / 180 : 6 * Math.PI / 180;
      sim.controls.pitch = clamp(6 * (target - ac.euler[1]) - 1.5 * ac.omega.y, -0.8, 0.8) * (ac.cas / KT > 30 ? 1 : 0);
      maxAgl = Math.max(maxAgl, ac.agl);
    });
    console.log(`Portmoak winch: top ${maxAgl.toFixed(0)} m AGL, crashed ${ac.crashed}`);
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(maxAgl).toBeGreaterThan(100);
    world.setAirport('EGPH');
  });
});
