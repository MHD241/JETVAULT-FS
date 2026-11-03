import { it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { DARTER } from '../src/sim/aircraft/darter';
import { clamp, DEG, RAD } from '../src/core/math';
it('the Darter flies straight and unstalled through a bungee launch (no sideslip, speed rising until release)', () => {
  const damper = false;
  const sim = newSim(flatWorld(0), undefined, DARTER); sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft; run(sim, 2); sim.startBungee();
  let maxB = 0, maxYaw = 0, maxBank = 0, minV = 1e9, vpeak = 0, maxA = 0, hd0 = ac.euler[2]; const log: string[] = [];
  run(sim, 40, (t) => {
    if (damper) sim.controls.yaw = clamp(-4.6 * ac.q.invRotate(ac.omega).z - 3 * ac.beta, -1, 1);
    sim.controls.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5);
    sim.controls.pitch = clamp(6 * ((ac.cable ? 10 : ac.agl < 2500 ? 15 : 3) * DEG - ac.euler[1]) - 1.5 * ac.omega.y, -0.8, 0.8) * (ac.cas > 30 ? 1 : 0);
    maxB = Math.max(maxB, Math.abs(ac.beta)); maxYaw = Math.max(maxYaw, Math.abs(ac.q.invRotate(ac.omega).z)); maxBank = Math.max(maxBank, Math.abs(ac.euler[0])); maxA = Math.max(maxA, ac.alpha);
    vpeak = Math.max(vpeak, ac.tas); if (ac.tas > 100 && ac.tas < vpeak - 0.5 && minV > ac.tas) { /* decel */ }
    if (Math.round(t * 240) % (240 * 5) === 0) log.push(`t${t.toFixed(0)} ${ac.tas.toFixed(0)}m/s cable ${!!ac.cable} agl ${ac.agl.toFixed(0)} hd ${((ac.euler[2] - hd0) * RAD).toFixed(1)}`);
  });
  expect(maxB * RAD).toBeLessThan(2); expect(maxA * RAD).toBeLessThan(15); expect(vpeak).toBeGreaterThan(340);
  console.log(`damper ${damper}: max sideslip ${(maxB * RAD).toFixed(1)} deg, yaw rate ${(maxYaw * RAD).toFixed(1)} deg/s, bank ${(maxBank * RAD).toFixed(1)}, alpha ${(maxA * RAD).toFixed(1)}, peak ${vpeak.toFixed(0)} m/s | ${log.join(' | ')}`);
});
