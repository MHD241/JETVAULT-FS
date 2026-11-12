// Floating hull: an aircraft that lands on the sea floats where the water it displaces weighs as much as it does, bobs and settles; a hard drop
// goes deeper first and comes back to the same level; over a long time it slowly floods and settles lower.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { B738 } from '../src/sim/aircraft/b738';
import { seaHeight } from '../src/world/waves';

function ditch(z: number, vz: number, vx: number, seconds: number) {
  const sim = newSim(flatWorld(0), undefined, B738);
  sim.spawnAir(0, -20000, 5, 0);
  sim.env.ground = { heightAt: () => -60, surfaceAt: () => ({ friction: 0.05, rolling: 0.5, kind: 'water' }) } as never;
  sim.env.water = (e, n) => seaHeight(e, n, 0, 0.2);   // calm sea
  const ac = sim.aircraft;
  ac.pos.z = z; ac.vel.z = vz; ac.vel.x = vx;
  const alts: number[] = [];
  for (let s = 0; s < seconds; s++) { run(sim, 1); alts.push(-ac.pos.z); }
  return { ac, alts, sim };
}

describe('water', () => {
  it('floats on its hull: partly submerged, settles, no pop-up and no endless sinking', () => {
    const { ac, alts } = ditch(-4, 6, 25, 120);
    const last = alts[alts.length - 1];
    console.log('float: min alt', Math.min(...alts).toFixed(2), 'final', last.toFixed(2), 'speed', ac.vel.len().toFixed(2));
    expect(last).toBeGreaterThan(0.2);                // the centre line stays above water: the round hull is only partly submerged
    expect(last).toBeLessThan(1.8);                   // ...but it is not pushed up out of the water
    expect(ac.vel.len()).toBeLessThan(8);
    expect(Math.abs(alts[119] - alts[110])).toBeLessThan(0.6);
  });
  it('a hard drop goes deeper first, then comes back to the same float level', () => {
    const soft = ditch(-3, 3, 10, 150).alts, hard = ditch(-25, 20, 40, 150).alts;
    console.log('hard: min', Math.min(...hard).toFixed(2), 'final', hard[149].toFixed(2), 'soft final', soft[149].toFixed(2));
    expect(Math.min(...hard)).toBeLessThan(soft[149] - 0.3);    // plunged deeper than the float level
    expect(Math.abs(hard[149] - soft[149])).toBeLessThan(1.0);  // and returned to about the same level
    expect(hard[149]).toBeGreaterThan(-3);
  });
  it('floods slowly over many minutes, and eventually sinks (it never pops back up)', () => {
    const r = ditch(-2, 2, 8, 2400);
    console.log('flood:', r.ac.flood.toFixed(2), 'alt at 2 min', r.alts[120].toFixed(2), 'at 40 min', r.alts[2399].toFixed(2));
    expect(r.ac.flood).toBeGreaterThan(0.5);
    expect(r.alts[2399]).toBeLessThan(r.alts[120] + 0.05);
  });
});
describe('water roll stability', () => {
  it('a rolled aircraft rights itself on the water (no endless banking)', () => {
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawnAir(0, -20000, 5, 0);
    sim.env.ground = { heightAt: () => -60, surfaceAt: () => ({ friction: 0.05, rolling: 0.5, kind: 'water' }) } as never;
    sim.env.water = (e, n) => seaHeight(e, n, 0, 0.3);
    const ac = sim.aircraft;
    ac.pos.z = -1.2; ac.vel.x = 0; ac.vel.z = 0;
    ac.omega.x = 1.2; run(sim, 0.4);                   // kick it into a roll
    const bank0 = Math.abs(ac.euler[0]);
    run(sim, 40);
    const bank1 = Math.abs(ac.euler[0]);
    console.log('bank start', (bank0 * 57.3).toFixed(0), 'after 40 s', (bank1 * 57.3).toFixed(1));
    expect(bank1).toBeLessThan(Math.max(0.12, bank0 * 0.5));
  });
});
