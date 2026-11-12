// The 737's trim schedule: with the schedule's trim for the flap detent and a centred stick, the aircraft holds its attitude (no pitching up or down).
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { B738 } from '../src/sim/aircraft/b738';
import { KT } from '../src/core/math';

describe('737 trim schedule', () => {
  it('has one trim per flap detent and each one holds the attitude at its speed', () => {
    const sched = B738.profile.trimSchedule!;
    expect(sched.length).toBe(B738.controls.flapDetents.length);
    const spd = [250, 215, 195, 180, 165, 155, 145, 140, 135];
    for (const lever of [0, 3, 5, 8]) {
      const sim = newSim(flatWorld(0), undefined, B738);
      sim.spawnAir(0, -20000, 3000, 0);
      const ac = sim.aircraft; ac.vel = ac.q.rotate({ x: spd[lever] * KT, y: 0, z: 0 } as never) as never;
      sim.controls.flapLever = lever; sim.controls.gearDown = lever >= 6; sim.controls.trim = sched[lever]; sim.controls.throttle = 0.5; sim.controls.pitch = 0;
      run(sim, 4); const th0 = ac.euler[1]; run(sim, 3);
      expect(Math.abs(ac.euler[1] - th0)).toBeLessThan(0.02);   // under about 1 degree in 3 s
    }
  });
});
