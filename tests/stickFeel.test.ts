import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { A320 } from '../src/sim/aircraft/airliners';
import { speedAuthority } from '../src/input/simpleControls';
import { KT, DEG } from '../src/core/math';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

/** Peak roll rate (deg/s) in 3 s after a full roll command at a given speed, with the stick scaled by `scale`. */
function rollRate(kias: number, scale: number) {
  const sim = newSim(world, CALM_ISA, A320);
  sim.spawnAir(0, 0, 8000, 0);
  const ac = sim.aircraft; ac.vel = ac.q.rotate(new (ac.vel.constructor as new (x: number, y: number, z: number) => typeof ac.vel)(kias * KT, 0, 0));
  sim.controls.throttle = 0.5; sim.controls.roll = scale; let peak = 0;
  for (let i = 0; i < 3 * 240; i++) { sim.step(); peak = Math.max(peak, Math.abs(ac.omega.x) / DEG); }
  return peak;
}
describe('stick feel', () => {
  it('authority is full at approach speed and falls with speed, to a floor', () => {
    const vref = A320.profile.approachKias * KT;
    expect(speedAuthority(vref * 0.8, vref)).toBe(1); expect(speedAuthority(vref, vref)).toBe(1);
    expect(speedAuthority(vref * 1.5, vref)).toBeCloseTo(0.675, 5); expect(speedAuthority(vref * 2.1, vref)).toBe(0.3); expect(speedAuthority(vref * 5, vref)).toBe(0.3);
  });
  it('full mouse deflection at cruise speed now rolls the A320 gently', () => {
    const vref = A320.profile.approachKias * KT, auth = speedAuthority(280 * KT, vref);
    const before = rollRate(280, 1), after = rollRate(280, auth);
    console.log(`A320 at 280 kt, full stick: peak roll rate ${before.toFixed(1)} deg/s before, ${after.toFixed(1)} deg/s now (authority ${auth.toFixed(2)})`);
    expect(after).toBeLessThan(before * 0.6); expect(after).toBeGreaterThan(3);
  });
});
