// Inspection drone: a kinematic flying camera (no physics): holds the chosen speed, altitude and attitude.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { DRONE } from '../src/sim/aircraft/drone';
import { droneSpeed } from '../src/sim/fdm/aircraft';

describe('inspection drone', () => {
  it('speed steps are exponential 45 .. 400 m/s, motor off at idle', () => {
    const d = DRONE.drone!;
    expect(droneSpeed(0, d)).toBe(0);
    expect(droneSpeed(0.125, d)).toBeCloseTo(45, 3);
    expect(droneSpeed(1, d)).toBeCloseTo(400, 3);
    expect(droneSpeed(0.5, d)).toBeGreaterThan(100);
    expect(droneSpeed(0.5, d)).toBeLessThan(130);
  });
  it('is a flying camera: holds speed, altitude and heading with the stick centred (no gravity, no shaking)', () => {
    const sim = newSim(flatWorld(0), undefined, DRONE);
    sim.spawnAir(0, -20000, 5000, 0);
    sim.controls.throttle = 0.5; // about 114 m/s
    const alt0 = sim.aircraft.altitude;
    run(sim, 30);
    const ac = sim.aircraft;
    expect(ac.tas).toBeGreaterThan(110);
    expect(ac.tas).toBeLessThan(118);
    expect(Math.abs(ac.altitude - alt0)).toBeLessThan(0.5);
    expect(ac.omega.len()).toBeLessThan(1e-9);
    // motor off = it simply stops and hovers
    sim.controls.throttle = 0; run(sim, 30);
    expect(ac.tas).toBeLessThan(0.5);
    expect(Math.abs(ac.altitude - alt0)).toBeLessThan(0.5);
  });
});
