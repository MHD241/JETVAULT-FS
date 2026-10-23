// "Plane keeps going up": with takeoff trim still set and the stick released, an aircraft
// returns to its trimmed (slow) speed and climbs - correct physics. The optional
// auto-trim assist moves the trim wheel so a released stick holds level flight.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { FT, DEG } from '../src/core/math';
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

describe('pushback tug', () => {
  it('b738: a 90 kN speed-limited tug pushes the aircraft backwards straight at ~1.5 m/s, then it holds with the parking brake', () => {
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft;
    sim.controls.throttle = 0.0;
    sim.controls.parkingBrake = false;
    run(sim, 2, () => {});
    const x0 = ac.pos.x, h0 = ac.euler[2];
    ac.tugSpeed = 1.5;
    run(sim, 30, () => {});
    const back = x0 - ac.pos.x, vx = ac.q.invRotate(ac.vel).x;
    console.log(`pushback: ${back.toFixed(1)} m back, body speed ${vx.toFixed(2)} m/s, heading change ${((ac.euler[2] - h0) / DEG).toFixed(2)} deg`);
    expect(back).toBeGreaterThan(30);
    expect(vx).toBeLessThan(-1.2);
    expect(Math.abs(ac.euler[2] - h0)).toBeLessThan(2 * DEG);
    ac.tugSpeed = null; sim.controls.parkingBrake = true;
    const sp: string[] = [];
    for (let i = 0; i < 4; i++) { run(sim, 10, () => {}); sp.push(Math.hypot(ac.vel.x, ac.vel.y).toFixed(3)); }
    console.log('after release, ground speed every 10 s:', sp.join(' '));
    expect(Math.hypot(ac.vel.x, ac.vel.y)).toBeLessThan(0.1);
    expect(ac.crashed).toBe(false);
  });
});
