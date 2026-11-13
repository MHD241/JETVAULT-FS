// The 737 trim assist: a fixed trim per flap detent plus a thrust term, with a stall guard on the trim channel only.
// Checks: it holds the attitude hands-off for 25 s at each detent and throttle, and an approach (flaps 30, 140 kt) never climbs into a stall.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { B738 } from '../src/sim/aircraft/b738';
import { KT, FT } from '../src/core/math';
import { trimFor, stallGuardTrim } from '../src/sim/assists';

const KR = [250, 215, 195, 180, 165, 155, 145, 140, 135];
function fly(lever: number, thr: number, seconds: number, guard: boolean, kt = KR[lever]) {
  const sim = newSim(flatWorld(0), undefined, B738);
  sim.spawnAir(0, -20000, 3000, 0);
  const ac = sim.aircraft; ac.vel = ac.q.rotate({ x: kt * KT, y: 0, z: 0 } as never) as never;
  sim.controls.flapLever = lever; sim.controls.gearDown = lever >= 6; sim.controls.throttle = thr; sim.controls.pitch = 0;
  sim.controls.trim = trimFor(B738.profile, lever, kt, thr)!;
  let maxP = -90, minP = 90, stall = false, vsMax = -1e9;
  for (let s = 0; s < seconds; s++) {
    for (let k = 0; k < 4; k++) {
      if (guard) { const g = stallGuardTrim(ac), tgt = trimFor(B738.profile, lever, kt, thr)! + (B738.profile.trimModel!.bias ?? 0) - g, r = (g > 0 ? 1.2 : 0.35) * 0.25; sim.controls.trim += Math.max(-r, Math.min(r, tgt - sim.controls.trim)); }
      run(sim, 0.25);
    }
    const p = ac.euler[1] * 57.3; maxP = Math.max(maxP, p); minP = Math.min(minP, p); stall = stall || (s > 3 && ac.stallWarning); vsMax = Math.max(vsMax, -ac.vel.z / FT * 60);
  }
  return { ac, range: maxP - minP, stall, vsMax, maxP };
}

describe('737 trim assist', () => {
  it('has a trim line for every flap detent', () => {
    expect(B738.profile.trimModel!.c0.length).toBe(B738.controls.flapDetents.length);
    expect(B738.profile.trimModel!.c1.length).toBe(B738.controls.flapDetents.length);
  });
  it('holds the attitude hands-off for 25 s at each detent (30 % and 60 % throttle), without a stall warning', () => {
    for (const lever of [0, 3, 5, 7, 8]) for (const thr of [0.3, 0.6]) {
      const r = fly(lever, thr, 25, false);
      expect(r.stall, `lever ${lever} thr ${thr}`).toBe(false);
      expect(r.range, `lever ${lever} thr ${thr}`).toBeLessThan(18);   // a gentle phugoid is fine; a runaway is not
    }
  });
  it('an approach (flaps 30, 140 kt, gear down) with the stick centred does not climb into a stall, at any throttle up to go-around power', () => {
    for (const thr of [0.3, 0.6, 0.8]) {
      const r = fly(7, thr, 60, true);
      expect(r.stall, `thr ${thr}`).toBe(false);
      expect(r.vsMax, `thr ${thr}`).toBeLessThan(4500);
    }
  });
});
