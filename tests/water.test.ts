// Ditching: an aircraft that falls into the sea sinks in, then floats and settles at a natural depth (buoyancy grows with depth, no forcing up).
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { B738 } from '../src/sim/aircraft/b738';
import { seaHeight } from '../src/world/waves';

describe('water', () => {
  it('sinks in on impact, then floats and settles (no pop-up, no endless sinking)', () => {
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawnAir(0, -20000, 5, 0);
    sim.env.ground = { heightAt: () => -60, surfaceAt: () => ({ friction: 0.05, rolling: 0.5, kind: 'water' }) } as never;
    sim.env.water = (e, n) => seaHeight(e, n, 0, 0.2);   // calm sea
    const ac = sim.aircraft;
    ac.pos.z = -4; ac.vel.z = 6; ac.vel.x = 25;   // 4 m up, descending at 6 m/s, 25 m/s forward
    const alts: number[] = [];
    for (let s = 0; s < 120; s++) { run(sim, 1); alts.push(-ac.pos.z); }
    console.log('trace', alts.filter((_, i) => i % 3 === 0).map((a) => a.toFixed(1)).join(' '));
    const min = Math.min(...alts), last = alts[alts.length - 1];
    console.log('water: min alt', min.toFixed(2), 'final alt', last.toFixed(2), 'speed', ac.vel.len().toFixed(2));
    expect(min).toBeLessThan(0);                     // it went below the surface
    expect(min).toBeGreaterThan(-12);                // a moderate dip, not a dive to the bottom
    expect(last).toBeGreaterThan(-6);                // and did not just keep sinking
    expect(last).toBeLessThan(2.5);                  // nor get forced up out of the water
    expect(ac.vel.len()).toBeLessThan(8);            // it slows right down (idle engine thrust and waves keep it drifting)
    expect(Math.abs(alts[119] - alts[110])).toBeLessThan(1.6);   // and settles into a gentle bob
  });
});
