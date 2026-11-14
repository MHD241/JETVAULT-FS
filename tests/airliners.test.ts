// The scaled airliners (A320, A340-600, A350-1000): rest on their gear at EGPH, take off, and fly a stable approach.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH, newSim, run, kt, TestPilot, CALM_ISA } from './helpers';
import { World } from '../src/world/world';
import { DEG, FT, clamp } from '../src/core/math';
import { A320, A340, A350 } from '../src/sim/aircraft/airliners';

let world: World;
beforeAll(async () => { world = await loadEGPH(); });

for (const [def, vr, name] of [[A320, 140, 'A320'], [A340, 160, 'A340-600'], [A350, 155, 'A350-1000']] as const) {
  describe(name, () => {
    it('rests on its gear at a stand (nose gear carries 5-15 % of the weight), no crash', () => {
      const sim = newSim(world, CALM_ISA, def);
      sim.spawn({ kind: 'stand', index: 0, coldAndDark: false });
      run(sim, 6);
      const ac = sim.aircraft, g = ac.gearStates, total = g.reduce((a, s) => a + s.force, 0);
      console.log(`${name} static: mass ${ac.mass.toFixed(0)} kg, nose ${(g[0].force / total * 100).toFixed(1)} %, struts ${g.map((s) => s.compression.toFixed(2)).join('/')} m`);
      expect(ac.crashed, ac.crashReason).toBe(false);
      expect(g[0].force / total).toBeGreaterThan(0.05);
      expect(g[0].force / total).toBeLessThan(0.16);
      expect(Math.abs(total - ac.mass * 9.80665) / total).toBeLessThan(0.03);
    });
    it('takes off from runway 24 and climbs away', () => {
      const sim = newSim(world, CALM_ISA, def);
      sim.spawn({ kind: 'runway', ident: '24' });
      const ac = sim.aircraft, c = sim.controls, psi0 = ac.euler[2], field = ac.altitude, log: Record<string, number> = {};
      c.throttle = 1.0; c.flapLever = def.profile.takeoffFlapLever; c.trim = 0;
      const p = new TestPilot(sim);
      run(sim, 150, (t) => {
        const [phi, th, psi] = ac.euler; let e = psi0 - psi; e = Math.atan2(Math.sin(e), Math.cos(e)); const ias = kt(ac.cas);
        if (ac.onGround || ac.agl < 15) {
          c.yaw = clamp(e * 4 - ac.omega.z * 2, -1, 1); c.roll = clamp(-phi * 2, -1, 1);
          if (ias > vr) { if (!log.vr) { log.vr = ias; log.vrT = t; } const tgt = ac.onGround ? 8 * DEG : 12 * DEG; c.pitch = clamp(1.5 * (tgt - th) - 2.5 * ac.omega.y + 0.2, -1, 1); } else c.pitch = 0;
        } else { p.holdSpeedWithPitch(vr + 25); p.wingsLevel(psi0); }
        if (t > 2 && !ac.onGround && !log.lift) { log.lift = ias; log.liftT = t; log.liftDist = Math.hypot(ac.pos.x, ac.pos.y); }
        if (ac.altitude - field > 1000 * FT) { log.at1000 = t; return true; }
      });
      console.log(`${name} takeoff: Vr ${log.vr?.toFixed(0)} kt at ${log.vrT?.toFixed(0)} s, lift-off ${log.lift?.toFixed(0)} kt at ${log.liftT?.toFixed(0)} s, 1000 ft at ${log.at1000?.toFixed(0)} s, mass ${ac.mass.toFixed(0)}`);
      expect(ac.crashed, ac.crashReason).toBe(false);
      expect(log.lift, 'it lifted off').toBeGreaterThan(100);
      expect(log.at1000, 'climbed to 1000 ft in 150 s').toBeGreaterThan(0);
    });
  });
}
