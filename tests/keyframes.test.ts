// Keyframed Director flights: the same path every time, never stalls, touches down on the runway.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { A320, C17 } from '../src/sim/aircraft/airliners';
import { KeyframeFlight } from '../src/sim/keyframes';
import { runwayEnd } from '../src/world/airport';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

function fly(def: typeof A320, kind: 'landing' | 'takeoff', secs: number) {
  const sim = newSim(world, CALM_ISA, def);
  sim.spawn(kind === 'landing' ? { kind: 'approach', ident: '24', distanceNm: 4 } : { kind: 'runway', ident: '24' });
  const f = new KeyframeFlight(sim, kind, '24');
  sim.preStep = () => f.step();
  const log: { t: number; alt: number; s: number; cas: number; vz: number }[] = [];
  const { end } = runwayEnd(world.airport, '24');
  const ux = Math.sin(end.hdgTrue * Math.PI / 180), uy = Math.cos(end.hdgTrue * Math.PI / 180);
  for (let i = 0; i < 240 * secs; i++) {
    sim.step();
    if (i % 240 === 0) { const a = sim.aircraft; log.push({ t: i / 240, alt: a.altitude - world.heightAt(a.pos.y, a.pos.x), s: (a.pos.y - end.x) * ux + (a.pos.x - end.y) * uy, cas: a.vel.len(), vz: -a.vel.z }); }
  }
  return { log, sim };
}
describe('keyframed flights', () => {
  for (const [def, name] of [[A320, 'A320'], [C17, 'C-17']] as const) {
    it(`${name} lands on the same spot every time, never crashes`, () => {
      const a = fly(def, 'landing', 40), b = fly(def, 'landing', 40);
      expect(a.sim.aircraft.crashed).toBe(false);
      expect(a.log.map((x) => x.alt.toFixed(3))).toEqual(b.log.map((x) => x.alt.toFixed(3)));
      const td = a.log.find((x) => x.alt < def.spawnHeight + 0.3 && x.t > 5)!;
      console.log(name, 'touchdown at', td.t, 's, along', td.s.toFixed(0), 'm, speed', td.cas.toFixed(0), 'm/s; sink before', a.log[Math.max(0, a.log.indexOf(td) - 1)].vz.toFixed(2));
      expect(td.s).toBeGreaterThan(200); expect(td.s).toBeLessThan(900);
      expect(Math.min(...a.log.map((x) => x.alt))).toBeGreaterThan(def.spawnHeight - 0.5);   // never below the wheels
    });
    it(`${name} landing and takeoff paths never hit the ground or a building`, () => {
      for (const kind of ['landing', 'takeoff'] as const) {
        const sim = newSim(world, CALM_ISA, def);
        sim.spawn(kind === 'landing' ? { kind: 'approach', ident: '24', distanceNm: 4 } : { kind: 'runway', ident: '24' });
        const f = new KeyframeFlight(sim, kind, '24'); sim.preStep = () => f.step();
        for (let i = 0; i < 240 * 60; i++) { sim.step(); const a = sim.aircraft; expect(a.altitude - world.heightAt(a.pos.y, a.pos.x)).toBeGreaterThan(def.spawnHeight - 0.01); }
        expect(f.collided, kind).toBe(false);
      }
    });
    it(`${name} takes off and climbs away`, () => {
      const a = fly(def, 'takeoff', 60);
      console.log(name, 'takeoff', a.log.filter((_, i) => i % 10 === 0).map((x) => `${x.t}s ${x.alt.toFixed(0)}m ${x.cas.toFixed(0)}m/s`).join(' | '));
      expect(a.log[a.log.length - 1].alt).toBeGreaterThan(100);
    });
  }
});
