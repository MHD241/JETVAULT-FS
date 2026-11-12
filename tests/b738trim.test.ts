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

describe('737 trim model (speed and thrust)', () => {
  it('matches the measured neutral trim within 0.12 over speed and throttle', async () => {
    const { trimFor } = await import('../src/sim/assists');
    // measured with the flight model: [flap lever, kt, throttle, trim]
    const m: [number, number, number, number][] = [[0, 250, 0.2, -0.166], [0, 250, 1.0, -0.480], [0, 300, 0.5, -0.425], [0, 220, 0.8, -0.253], [3, 180, 0.2, 0.163], [3, 180, 1.0, -0.486], [3, 150, 0.5, 0.282], [3, 210, 0.8, -0.453], [6, 145, 0.2, 0.590], [6, 145, 1.0, -0.349], [6, 165, 0.8, -0.198]];
    for (const [lv, kt, thr, tr] of m) expect(Math.abs(trimFor(B738.profile, lv, kt, thr)! - tr), `lever ${lv} ${kt} kt thr ${thr}`).toBeLessThan(0.12);
  });
});

describe('737 trim model in flight', () => {
  it('holds the attitude hands-off at low and high throttle (no pitching up with power)', async () => {
    const { trimFor } = await import('../src/sim/assists');
    for (const [lever, kt, thr] of [[3, 190, 1.0], [3, 190, 0.2], [0, 280, 0.9], [6, 150, 0.7]] as [number, number, number][]) {
      const sim = newSim(flatWorld(0), undefined, B738);
      sim.spawnAir(0, -20000, 3000, 0);
      const ac = sim.aircraft; ac.vel = ac.q.rotate({ x: kt * KT, y: 0, z: 0 } as never) as never;
      sim.controls.flapLever = lever; sim.controls.gearDown = lever >= 6; sim.controls.throttle = thr; sim.controls.pitch = 0;
      sim.controls.trim = trimFor(B738.profile, lever, kt, thr)!;
      run(sim, 3); const th0 = ac.euler[1]; run(sim, 3);
      expect(Math.abs(ac.euler[1] - th0), `lever ${lever} ${kt} kt thr ${thr}`).toBeLessThan(0.035);   // about 2 degrees in 3 s
    }
  });
});
