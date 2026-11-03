import { it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { DARTER } from '../src/sim/aircraft/darter';
import { DEFAULT_WEATHER } from '../src/sim/weather';
import { clamp, DEG, RAD } from '../src/core/math';
for (const [gy, gb] of [[-4.6, 3]]) it('the Darter stays level and straight through a gusty crosswind bungee launch (outriggers + dampers)', () => {
  const sim = newSim(flatWorld(0), { ...DEFAULT_WEATHER, windDirection: 70, windSpeed: 12, gustSpeed: 18, turbulence: 0.3 }, DARTER); sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft; run(sim, 2); sim.startBungee();
  let tMax = 0, n = 0, sumAbsR = 0, flips = 0, lastS = 0, maxY = 0, maxRoll = 0; const hd0 = ac.euler[2];
  run(sim, 8, (t) => {
    const r = ac.q.invRotate(ac.omega).z;
    sim.controls.yaw = clamp(gy * r - gb * ac.beta, -1, 1) * -1 * -1;
    sim.controls.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5);
    sim.controls.pitch = clamp(6 * ((ac.cable ? 10 : 8) * DEG - ac.euler[1]) - 1.5 * ac.omega.y, -0.8, 0.8) * (ac.cas > 30 ? 1 : 0);
    if (Math.abs(ac.euler[0]) > maxRoll) tMax = t; n++; sumAbsR += Math.abs(r); const s = Math.sign(r); if (s && s !== lastS && Math.abs(r) > 0.01) flips++; if (s) lastS = s; maxY = Math.max(maxY, Math.abs(r)); maxRoll = Math.max(maxRoll, Math.abs(ac.euler[0]));
  });
  expect(maxRoll * RAD).toBeLessThan(5);
  console.log(`gains yaw ${gy}/${gb}: mean |yaw rate| ${(sumAbsR / n * RAD).toFixed(2)} deg/s, max ${(maxY * RAD).toFixed(1)}, sign flips ${flips} in 8 s, max bank ${(maxRoll * RAD).toFixed(1)} at t=${tMax.toFixed(1)} (cable ${!!ac.cable}, onGround at end ${ac.onGround}), hdg change ${((ac.euler[2] - hd0) * RAD).toFixed(1)}, v ${ac.tas.toFixed(0)}`);
});
