// C172S flight-model validation against the Pilot's Operating Handbook.
// All manoeuvres are flown by scripted pilots that only move the controls.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run, kt, ft, TestPilot, LandingPilot } from './helpers';
import { KT, FT, DEG, clamp } from '../src/core/math';

function atMTOW(sim: ReturnType<typeof newSim>) {
  const ac = sim.aircraft;
  ac.payload[1] += 1157 - ac.mass; // front passenger brings the aircraft to 2550 lb
  ac.updateMass();
}

function airborne(altFt: number, kias: number, mtow = true) {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  if (mtow) atMTOW(sim);
  sim.aircraft.placeInFlight(0, 1000, altFt * FT, 0, kias * KT * 1.05, 0);
  return sim;
}

describe('C172S performance vs POH (ISA, calm, 2550 lb unless noted)', () => {
  it('takeoff ground roll, flaps 10, sea level: POH 960 ft (+/-15 %)', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    atMTOW(sim);
    const ac = sim.aircraft, c = sim.controls;
    c.flapLever = 1; ac.flap = 10 * DEG;
    c.brakeLeft = c.brakeRight = 1; c.throttle = 1;
    run(sim, 6);
    c.brakeLeft = c.brakeRight = 0;
    const y0 = ac.pos.x;
    let roll = 0;
    run(sim, 60, () => {
      const [phi, th, psi] = ac.euler;
      c.yaw = clamp(-psi * 6 - ac.pos.y * 0.05 - ac.omega.z * 2, -1, 1);
      c.roll = clamp(-phi * 3, -1, 1);
      c.pitch = kt(ac.cas) > 49 ? clamp(6 * (10 * DEG - th) - ac.omega.y, -1, 1) : 0;
      if (!ac.onGround) { roll = ac.pos.x - y0; return true; }
    });
    const rollFt = ft(roll);
    console.log(`takeoff ground roll ${rollFt.toFixed(0)} ft`);
    expect(rollFt).toBeGreaterThan(960 * 0.85);
    expect(rollFt).toBeLessThan(960 * 1.15);
  });

  it('rate of climb at Vy (74 KIAS), full throttle, sea level: POH 730 fpm (+/-15 %)', () => {
    const sim = airborne(300, 74);
    sim.controls.throttle = 1;
    const p = new TestPilot(sim);
    run(sim, 25, () => { p.holdSpeedWithPitch(74); p.wingsLevel(0); });
    const a0 = sim.aircraft.altitude;
    run(sim, 30, () => { p.holdSpeedWithPitch(74); p.wingsLevel(0); });
    const roc = ((sim.aircraft.altitude - a0) / 30 / FT) * 60;
    console.log(`Vy climb ${roc.toFixed(0)} fpm (avg altitude ~${ft(a0).toFixed(0)} ft)`);
    expect(roc).toBeGreaterThan(730 * 0.85);
    expect(roc).toBeLessThan(730 * 1.15);
  });

  it('cruise, 8000 ft, full throttle, best-power mixture: POH ~124 KTAS (+/-6 %)', () => {
    const sim = airborne(8000, 105, false);
    const c = sim.controls; c.throttle = 1;
    const p = new TestPilot(sim);
    const hold = () => { p.holdAltitudeWithPitch(8000 * FT); p.wingsLevel(0); };
    run(sim, 20, hold);
    let best = 1, bestP = 0;
    for (let m = 1; m >= 0.6; m -= 0.02) {
      c.mixture = m; run(sim, 1.5, hold);
      if (sim.aircraft.engine.power > bestP) { bestP = sim.aircraft.engine.power; best = m; }
    }
    c.mixture = best;
    run(sim, 200, hold);
    const ktas = kt(sim.aircraft.tas);
    console.log(`cruise ${ktas.toFixed(1)} KTAS at ${sim.aircraft.engine.rpm.toFixed(0)} rpm`);
    expect(ktas).toBeGreaterThan(124 * 0.94);
    expect(ktas).toBeLessThan(124 * 1.06);
    expect(Math.abs(ft(sim.aircraft.altitude) - 8000)).toBeLessThan(50);
  });

  for (const [flaps, poh] of [[0, 48], [3, 40]] as const) {
    it(`power-off stall speed, flaps ${flaps * 10}: POH ${poh} KCAS (+/-4 kt)`, () => {
      const sim = airborne(4000, 70);
      const c = sim.controls; c.throttle = 0; c.flapLever = flaps; sim.aircraft.flap = flaps * 10 * DEG;
      const p = new TestPilot(sim);
      let stall = 0;
      run(sim, 120, () => {
        const ac = sim.aircraft;
        p.holdAltitudeWithPitch(4000 * FT); p.wingsLevel(0);
        if (c.pitch > 0.98 && ac.vel.z > 3) { stall = kt(ac.cas); return true; }
      });
      console.log(`stall flaps ${flaps * 10}: ${stall.toFixed(1)} KCAS, horn ${sim.aircraft.stallWarning}`);
      expect(Math.abs(stall - poh)).toBeLessThan(4);
      expect(sim.aircraft.stallWarning).toBe(true);
    });
  }

  it('landing, flaps 30, max braking: POH ground roll 575 ft (within +30 % for a 54 kt touchdown)', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'approach', ident: '36', distanceNm: 2 });
    atMTOW(sim);
    sim.controls.flapLever = 3;
    const lp = new LandingPilot(sim, 0, 0, 0, 0, 62, 300);
    run(sim, 300, () => { lp.step(); if (lp.phase === 'stopped') return true; });
    expect(sim.aircraft.crashed).toBe(false);
    expect(lp.phase).toBe('stopped');
    const td = lp.touchdown!;
    const rollFt = ft(lp.stop!.y - td.y);
    console.log(`landing: touchdown ${td.kias.toFixed(1)} KIAS, ${td.sinkFpm.toFixed(0)} fpm, roll ${rollFt.toFixed(0)} ft`);
    expect(td.sinkFpm).toBeLessThan(400);
    expect(rollFt).toBeGreaterThan(575 * 0.8);
    expect(rollFt).toBeLessThan(575 * 1.3);
    expect(Math.abs(sim.aircraft.pos.y)).toBeLessThan(10); // stayed on the runway
  });
});
