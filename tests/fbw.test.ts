// Fly-by-wire assist and autopilot: hands-off the jets hold their flight path, wings level themselves, the autopilot captures altitude, heading and speed.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, run, kt, TestPilot, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { DEG, FT, clamp } from '../src/core/math';
import { B738 } from '../src/sim/aircraft/b738';
import { A320, A340, A350, C17 } from '../src/sim/aircraft/airliners';
import { FlyByWire } from '../src/sim/fbw';
import { PHYSICS_DT } from '../src/sim/simulation';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

/** Take off with the test pilot and climb to about 2500 ft AGL, then hand over. */
function airborne(def: typeof B738, vr: number, cruise: number) {
  const sim = newSim(world, CALM_ISA, def);
  sim.spawn({ kind: 'runway', ident: '24' });
  { const d = def; const fuelKg = d.tanks.reduce((a, x) => a + x.capacity, 0) * 0.8, pay = d.stations.reduce((a, x) => a + x.mass, 0), f = d === B738 ? 0.45 : Math.max(0.2, Math.min(1, (0.85 * d.maxTakeoffMass - d.emptyMass - pay) / fuelKg)); sim.aircraft.fuel = d.tanks.map((x) => x.capacity * f); }   // the game's loading: about 85 % of MTOW
  const ac = sim.aircraft, c = sim.controls, psi0 = ac.euler[2], field = ac.altitude;
  c.throttle = 1.0; c.flapLever = def.profile.takeoffFlapLever; c.trim = 0;
  const p = new TestPilot(sim);
  run(sim, 200, () => {
    const [phi, th, psi] = ac.euler; let e = psi0 - psi; e = Math.atan2(Math.sin(e), Math.cos(e)); const ias = kt(ac.cas);
    if (ac.onGround || ac.agl < 15) {
      c.yaw = clamp(e * 4 - ac.omega.z * 2, -1, 1); c.roll = clamp(-phi * 2, -1, 1);
      if (ias > vr) { const tgt = ac.onGround ? 8 * DEG : 12 * DEG; c.pitch = clamp(1.5 * (tgt - th) - 2.5 * ac.omega.y + 0.2, -1, 1); } else c.pitch = 0;
    } else { p.holdSpeedWithPitch(vr + 25); p.wingsLevel(psi0); }
    if (ac.altitude - field > 2500 * FT) return true;
  });
  c.flapLever = 0; c.throttle = 0.9;
  run(sim, 40, () => { p.holdSpeedWithPitch(cruise); p.wingsLevel(psi0); });
  return { sim, ac, c, psi0 };
}

for (const [def, vr, cruise, name] of [[B738, 140, 200, '737'], [A320, 140, 200, 'A320'], [A340, 160, 250, 'A340'], [A350, 155, 250, 'A350'], [C17, 145, 240, 'C-17']] as const) {
  describe('FBW ' + name, () => {
    it('holds the flight path hands-off, levels the wings, and the autopilot captures altitude, heading and speed', () => {
      const { sim, ac, c } = airborne(def, vr, cruise);
      const fbw = new FlyByWire();
      const step = (sp: number, sr: number) => { fbw.update(PHYSICS_DT, ac, sp, sr, c, 0); c.yaw = clamp(-4.6 * ac.q.invRotate(ac.omega).z, -1, 1); sim.step(); };
      const gam = () => Math.atan2(-ac.vel.z, Math.hypot(ac.vel.x, ac.vel.y)) / DEG;
      // 1. level off with the stick (pitch rate command), settle, then hands off
      c.throttle = def === A340 ? 0.5 : 0.6;   // about the cruise thrust of each
      for (let i = 0; i < 40 * 240 && gam() > 2; i++) step(-0.6, 0);
      for (let i = 0; i < 5 * 240; i++) step(0, 0);
      const g0 = gam();
      for (let i = 0; i < 10 * 240; i++) { step(0, 0); if (process.env.FBWDBG && i % 480 === 0) console.log(`  h ${i / 240}s gam ${gam().toFixed(1)} q ${(ac.omega.y / DEG).toFixed(2)} cas ${kt(ac.cas).toFixed(0)} aoa ${(ac.alpha / DEG).toFixed(1)} pitch ${c.pitch.toFixed(2)}`); }
      const g1 = gam();
      for (let i = 0; i < 20 * 240; i++) step(0, 0);
      const g2 = gam();
      console.log(`${name}: gamma after nudge ${g0.toFixed(1)} -> +10 s ${g1.toFixed(1)} -> +30 s ${g2.toFixed(1)} deg, speed ${kt(ac.cas).toFixed(0)} kt`);
      expect(Math.abs(g2 - g1), 'flight path steady hands-off').toBeLessThan(1.6);
      // 2. bank 25 deg with the stick, release: wings level again
      for (let i = 0; i < 6 * 240; i++) step(0, 0.7);
      const bankHeld = ac.euler[0] / DEG;
      for (let i = 0; i < 12 * 240; i++) step(0, 0);
      const bankAfter = ac.euler[0] / DEG;
      console.log(`${name}: bank held ${bankHeld.toFixed(0)} deg, 12 s after release ${bankAfter.toFixed(1)} deg`);
      expect(Math.abs(bankHeld)).toBeGreaterThan(12);
      expect(Math.abs(bankAfter)).toBeLessThan(3);
      // 3. autopilot: +1000 ft, +40 deg heading, speed hold
      fbw.engageAp(ac);
      fbw.ap.alt += 1000 * FT; fbw.ap.hdg += 40 * DEG; const spd0 = ac.cas; fbw.ap.spd = spd0;
      const alt0 = ac.altitude, h0 = ac.euler[2];
      let maxBank = 0;
      for (let i = 0; i < 150 * 240; i++) { step(0, 0); c.throttle = fbw.throttleCmd; maxBank = Math.max(maxBank, Math.abs(ac.euler[0])); if (process.env.FBWDBG && i % (10 * 240) === 0) console.log(`  t=${i / 240}s alt ${((ac.altitude - alt0) / FT).toFixed(0)} cas ${kt(ac.cas).toFixed(0)} thr ${c.throttle.toFixed(2)} gam ${gam().toFixed(1)} aoa ${(ac.alpha / DEG).toFixed(1)} stallW ${ac.stallWarning} pitch ${c.pitch.toFixed(2)}`); }
      let dh = ac.euler[2] - (h0 + 40 * DEG); dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      console.log(`${name}: AP altitude error ${((ac.altitude - alt0) / FT - 1000).toFixed(0)} ft, heading error ${(dh / DEG).toFixed(1)} deg, speed error ${kt(ac.cas - spd0).toFixed(1)} kt, max bank ${(maxBank / DEG).toFixed(0)}`);
      expect(ac.crashed, ac.crashReason).toBe(false);
      expect(Math.abs((ac.altitude - alt0) / FT - 1000)).toBeLessThan(100);
      expect(Math.abs(dh / DEG)).toBeLessThan(3);
      expect(Math.abs(kt(ac.cas - spd0))).toBeLessThan(10);
    });
  });
}
