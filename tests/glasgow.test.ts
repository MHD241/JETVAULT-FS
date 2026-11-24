// Glasgow (EGPF) patch: loads in the shared Scotland frame, has its runways, terrain and buildings, and the scripted keyframe flights work there.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { A320 } from '../src/sim/aircraft/airliners';
import { KeyframeFlight } from '../src/sim/keyframes';

let world: World;
beforeAll(async () => { world = await loadEGPH(['egph', 'egpf']); world.setAirport('EGPF'); });

describe('Glasgow', () => {
  it('is selectable, with its two runway ends and sensible terrain', () => {
    expect(world.airport.icao).toBe('EGPF');
    const ends = world.airport.runways.flatMap((r) => r.ends).map((e) => e.ident).sort();
    expect(ends).toEqual(['05', '23']);
    for (const e of world.airport.runways.flatMap((r) => r.ends)) { const h = world.heightAt(e.x, e.y); expect(h).toBeGreaterThan(0); expect(h).toBeLessThan(30); expect(Math.abs(h - e.elev)).toBeLessThan(3); }
  });
  it('a keyframed A320 landing on 23 touches down on the runway without hitting anything', () => {
    const sim = newSim(world, CALM_ISA, A320);
    sim.spawn({ kind: 'approach', ident: '23', distanceNm: 4 });
    const f = new KeyframeFlight(sim, 'landing', '23'); sim.preStep = () => f.step();
    for (let i = 0; i < 240 * 45; i++) sim.step();
    expect(f.collided).toBe(false);
    const a = sim.aircraft; expect(a.altitude - world.heightAt(a.pos.y, a.pos.x)).toBeLessThan(A320.spawnHeight + 1);
  });
});
