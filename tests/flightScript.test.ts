// The Director's scripted pilots: each jet takes off by itself, climbs and levels off, and (from the approach spawn) lands and rolls to a stop.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, run, kt, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { FT } from '../src/core/math';
import { B738 } from '../src/sim/aircraft/b738';
import { A320, A340, A350, C17 } from '../src/sim/aircraft/airliners';
import { FlightScript } from '../src/sim/flightScript';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

for (const [def, name] of [[B738, '737'], [A320, 'A320'], [A340, 'A340'], [A350, 'A350'], [C17, 'C-17']] as const) {
  describe('scripted ' + name, () => {
    it('takes off, gear up, flaps up, and levels off at 3,000 ft', () => {
      const sim = newSim(world, CALM_ISA, def);
      sim.spawn({ kind: 'runway', ident: '24' });
      const ac = sim.aircraft, field = ac.altitude;
      { const d = def; const fuelKg = d.tanks.reduce((a, x) => a + x.capacity, 0) * 0.8, pay = d.stations.reduce((a, x) => a + x.mass, 0), f = d === B738 ? 0.45 : Math.max(0.2, Math.min(1, (0.85 * d.maxTakeoffMass - d.emptyMass - pay) / fuelKg)); ac.fuel = d.tanks.map((x) => x.capacity * f); }
      const script = new FlightScript(sim, 'takeoff');
      sim.preStep = () => script.step();
      let tCruise = 0;
      run(sim, 330, (t) => { if (script.phase === 'cruise' && !tCruise) tCruise = t; return false; });
      const agl = (ac.altitude - field) / FT;
      console.log(`${name} takeoff: phase ${script.phase}, cruise reached at ${tCruise.toFixed(0)} s, ${agl.toFixed(0)} ft AGL, ${kt(ac.cas).toFixed(0)} kt, gear ${sim.controls.gearDown ? 'down' : 'up'}, flaps ${sim.controls.flapLever}`);
      expect(ac.crashed, ac.crashReason).toBe(false);
      expect(script.phase).toBe('cruise');
      expect(Math.abs(agl - 3000)).toBeLessThan(200);
      expect(sim.controls.gearDown).toBe(false);
      expect(sim.controls.flapLever).toBe(0);
      expect(kt(ac.cas)).toBeGreaterThan(190);
    });
    for (const nm of [4]) it(`flies the approach from ${nm} nm, lands and rolls to a stop on the runway`, () => {
      const sim = newSim(world, CALM_ISA, def);
      sim.spawn({ kind: 'approach', ident: '24', distanceNm: nm });
      { const d = def; const fuelKg = d.tanks.reduce((a, x) => a + x.capacity, 0) * 0.8, pay = d.stations.reduce((a, x) => a + x.mass, 0), f = Math.max(0.15, Math.min(1, (0.72 * d.maxTakeoffMass - d.emptyMass - pay) / fuelKg)); sim.aircraft.fuel = d.tanks.map((x) => x.capacity * f); sim.aircraft.updateMass(); }   // a landing weight of about 72 % of MTOW
      const script = new FlightScript(sim, 'landing', '24');
      sim.preStep = () => script.step();
      const t = run(sim, 420, () => script.done);
      const ac = sim.aircraft;
      const lp = (script as unknown as { landing: { touchdown: { sinkFpm: number; kias: number } | null; track(): { along: number; cross: number } } }).landing;
      console.log(`${name} landing: phase ${script.phase} after ${t.toFixed(0)} s, touchdown ${lp.touchdown ? `${lp.touchdown.kias.toFixed(0)} kt, sink ${lp.touchdown.sinkFpm.toFixed(0)} fpm` : 'none'}, stopped at ${lp.track().along.toFixed(0)} m along, ${lp.track().cross.toFixed(1)} m off the centreline`);
      expect(ac.crashed, ac.crashReason).toBe(false);
      expect(script.done, 'came to a stop').toBe(true);
      expect(lp.touchdown!.sinkFpm).toBeLessThan(600);
      expect(Math.abs(lp.track().cross)).toBeLessThan(25);
    });
  });
}
