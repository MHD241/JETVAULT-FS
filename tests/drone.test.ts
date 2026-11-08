// Inspection drone: the speed-hold motor accelerates it toward the speed chosen with the throttle keys; motor off = coasting.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { DRONE } from '../src/sim/aircraft/drone';
import { droneSpeed } from '../src/sim/fdm/aircraft';
import { AutoTrim } from '../src/sim/assists';

describe('inspection drone', () => {
  it('speed steps are exponential 45 .. 400 m/s, motor off at idle', () => {
    const d = DRONE.drone!;
    expect(droneSpeed(0, d)).toBe(0);
    expect(droneSpeed(0.125, d)).toBeCloseTo(45, 3);
    expect(droneSpeed(1, d)).toBeCloseTo(400, 3);
    expect(droneSpeed(0.5, d)).toBeGreaterThan(100);
    expect(droneSpeed(0.5, d)).toBeLessThan(130);
  });
  it('accelerates under power toward the chosen speed and keeps flying', () => {
    const sim = newSim(flatWorld(0), undefined, DRONE);
    sim.spawnAir(0, -20000, 5000, 0);
    sim.aircraft.vel = sim.aircraft.vel.scale(60 / sim.aircraft.vel.len());
    sim.controls.throttle = 0.5; // target about 114 m/s
    const at = new AutoTrim(); let vmax = 0;
    run(sim, 40, () => { sim.controls.roll = -sim.aircraft.euler[0]; at.update(1 / 240, sim.aircraft, sim.controls, 0); vmax = Math.max(vmax, sim.aircraft.tas); });
    console.log(`drone: peak ${vmax.toFixed(0)} m/s, final ${sim.aircraft.tas.toFixed(0)} m/s, alt ${(sim.aircraft.altitude).toFixed(0)} m`);
    expect(Number.isFinite(sim.aircraft.tas)).toBe(true);
    expect(vmax).toBeGreaterThan(95);
  });
});
