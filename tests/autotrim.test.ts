// "Plane keeps going up": with takeoff trim still set and the stick released, an aircraft
// returns to its trimmed (slow) speed and climbs - correct physics. The optional
// auto-trim assist moves the trim wheel so a released stick holds level flight.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { FT } from '../src/core/math';
import { AutoTrim } from '../src/sim/assists';
import { C172 } from '../src/sim/aircraft/c172';
import { B738 } from '../src/sim/aircraft/b738';

for (const def of [C172, B738]) {
  describe(`${def.name}: stick released with takeoff trim set`, () => {
    const setup = () => {
      const sim = newSim(flatWorld(0), undefined, def);
      sim.spawnAir(0, -20000, 3000, 0);
      sim.controls.trim = def.profile.takeoffTrim; // pilot forgot to retrim after takeoff
      return sim;
    };
    it('without assist it climbs on its own (trimmed for a slower speed)', () => {
      const sim = setup();
      const a0 = sim.aircraft.altitude;
      run(sim, 60, () => { sim.controls.pitch = 0; sim.controls.roll = -sim.aircraft.euler[0]; });
      const gain = (sim.aircraft.altitude - a0) / FT;
      console.log(`${def.id} no assist: +${gain.toFixed(0)} ft in 60 s`);
      expect(gain).toBeGreaterThan(300);
    });
    it('with auto-trim it holds level flight (within 150 ft over 2 minutes)', () => {
      const sim = setup();
      const at = new AutoTrim();
      const a0 = sim.aircraft.altitude;
      let maxDev = 0;
      run(sim, 120, () => {
        sim.controls.roll = -sim.aircraft.euler[0];
        sim.controls.pitch = at.update(1 / 240, sim.aircraft, sim.controls, 0); // stick released; assist adds its servo
        maxDev = Math.max(maxDev, Math.abs(sim.aircraft.altitude - a0) / FT);
      });
      console.log(`${def.id} auto-trim: max deviation ${maxDev.toFixed(0)} ft, final trim ${sim.controls.trim.toFixed(2)}`);
      expect(maxDev).toBeLessThan(150);
      expect(sim.aircraft.crashed).toBe(false);
    });
  });
}
