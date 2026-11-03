import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run, kt } from './helpers';
import { GLIDER } from '../src/sim/aircraft/glider';
import { clamp, DEG } from '../src/core/math';

describe('bungee launch (game invention)', () => {
  it('accelerates a glider on the ground to supersonic speed and lets go', () => {
    const sim = newSim(flatWorld(0), undefined, GLIDER);
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft;
    run(sim, 2);
    expect(sim.startBungee()).toBe(true);
    let vmax = 0, hmax = 0, rel = -1;
    run(sim, 30, (t) => {
      ac.cable && (sim.controls.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5));
      sim.controls.pitch = clamp(6 * ((ac.cable ? 12 : 0) * DEG - ac.euler[1]) - 1.5 * ac.omega.y, -0.8, 0.8) * (ac.cas > 30 ? 1 : 0);
      vmax = Math.max(vmax, Math.hypot(ac.vel.x, ac.vel.y, ac.vel.z)); hmax = Math.max(hmax, ac.agl);
      if (!ac.cable && rel < 0) rel = t;
    });
    console.log(`bungee: peak ${vmax.toFixed(0)} m/s (${kt(vmax).toFixed(0)} kt, M${(vmax / 340).toFixed(2)}), released at ${rel.toFixed(1)} s, top ${hmax.toFixed(0)} m AGL`);
    expect(vmax).toBeGreaterThan(150);
  });
});
