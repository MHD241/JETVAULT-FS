// Dynamic stability and handling. A real C172 is statically and dynamically stable in
// pitch (well-damped short period, lightly damped phugoid), has a damped Dutch roll and a
// slow spiral mode. These tests check the free (hands-off) response of the flight model.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run, kt, TestPilot } from './helpers';
import { FT, KT, DEG, RAD } from '../src/core/math';

function trimmed(kias = 100, altFt = 4000) {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  // symmetric loading: pilot and passenger of equal weight
  sim.aircraft.payload[1] = sim.aircraft.payload[0];
  sim.aircraft.updateMass();
  sim.aircraft.placeInFlight(0, 1000, altFt * FT, 0, kias * KT * 1.06, 0);
  const c = sim.controls; c.throttle = 0.62;
  const p = new TestPilot(sim);
  // fly level, migrating the stick force into trim (as a pilot does)
  run(sim, 90, () => {
    p.holdAltitudeWithPitch(altFt * FT); p.wingsLevel(0);
    c.trim = Math.max(-1, Math.min(1, c.trim + c.pitch * (1 / 240) * 0.8));
  });
  const rollTrim = c.roll;
  c.pitch = 0; c.roll = 0; c.yaw = 0;
  return Object.assign(sim, { rollTrim });
}

describe('C172S stability (hands off after trimming)', () => {
  it('trims hands-off in level flight and stays within a gentle phugoid for 60 s', () => {
    const sim = trimmed();
    // rigging: wings stay level with (almost) no aileron at cruise power
    expect(Math.abs(sim.rollTrim)).toBeLessThan(0.01);
    const ac = sim.aircraft;
    const alt0 = ac.altitude, v0 = kt(ac.cas);
    let maxDAlt = 0, maxDV = 0, maxPitch = 0, maxBank = 0;
    run(sim, 60, () => {
      maxDAlt = Math.max(maxDAlt, Math.abs(ac.altitude - alt0));
      maxDV = Math.max(maxDV, Math.abs(kt(ac.cas) - v0));
      maxPitch = Math.max(maxPitch, Math.abs(ac.euler[1]));
      maxBank = Math.max(maxBank, Math.abs(ac.euler[0]));
    });
    console.log(`roll trim ${sim.rollTrim.toFixed(4)}; hands-off 60 s: dAlt ${(maxDAlt / FT).toFixed(0)} ft, dV ${maxDV.toFixed(1)} kt, pitch ${(maxPitch * RAD).toFixed(1)}, bank ${(maxBank * RAD).toFixed(1)}`);
    expect(maxDAlt / FT).toBeLessThan(200);
    expect(maxDV).toBeLessThan(10);
    expect(maxPitch * RAD).toBeLessThan(8);
    expect(maxBank * RAD).toBeLessThan(20);
  });

  it('spiral mode is slow: from a 10 deg bank, hands off, bank less than doubles in 20 s', () => {
    const sim = trimmed();
    const ac = sim.aircraft, c = sim.controls;
    c.roll = 0.3; run(sim, 0.4); c.roll = 0;
    run(sim, 2, () => { if (Math.abs(ac.euler[0]) > 10 * DEG) return true; });
    const b0 = Math.abs(ac.euler[0]);
    run(sim, 20);
    console.log(`spiral: bank ${(b0 * RAD).toFixed(1)} -> ${(Math.abs(ac.euler[0]) * RAD).toFixed(1)} deg in 20 s`);
    expect(Math.abs(ac.euler[0])).toBeLessThan(2 * b0);
  });

  it('short-period pitch response is well damped after a stick pulse', () => {
    const sim = trimmed();
    const ac = sim.aircraft, c = sim.controls;
    c.pitch = 0.4; run(sim, 0.5); c.pitch = 0;
    const qPeak = Math.abs(ac.omega.y);
    run(sim, 3);
    console.log(`pitch pulse: q at release ${(qPeak * RAD).toFixed(1)} deg/s, 3 s later ${(ac.omega.y * RAD).toFixed(2)} deg/s`);
    expect(qPeak * RAD).toBeGreaterThan(3);
    expect(Math.abs(ac.omega.y * RAD)).toBeLessThan(1.5);
  });

  it('positive static stability: speed returns toward trim after a disturbance', () => {
    const sim = trimmed();
    const ac = sim.aircraft;
    const v0 = kt(ac.cas);
    ac.vel = ac.vel.scale(1.12); // +12 % gust-like speed disturbance
    let peakAlt = 0;
    const a0 = ac.altitude;
    run(sim, 30, () => { peakAlt = Math.max(peakAlt, ac.altitude - a0); });
    // the aircraft converts excess speed into a climb (nose rises) - classic stable response
    expect(peakAlt).toBeGreaterThan(10);
    run(sim, 60);
    expect(Math.abs(kt(ac.cas) - v0)).toBeLessThan(8);
  });

  it('phugoid is stable at full power with nose-up trim (no growing oscillation, no loop)', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    sim.aircraft.placeInFlight(0, 1000, 1500 * FT, 0, 75 * KT, 0.05);
    const c = sim.controls; c.throttle = 1; c.trim = 0.3;
    const amp = (secs: number) => {
      let lo = Infinity, hi = -Infinity;
      run(sim, secs, () => {
        c.roll = -sim.aircraft.euler[0] * 2; c.pitch = 0; c.yaw = sim.aircraft.beta * 4;
        const th = sim.aircraft.euler[1]; lo = Math.min(lo, th); hi = Math.max(hi, th);
      });
      return (hi - lo) * RAD;
    };
    const first = amp(40); amp(40); const last = amp(40);
    console.log(`phugoid pitch swing: first 40 s ${first.toFixed(1)} deg, last 40 s ${last.toFixed(1)} deg`);
    expect(last).toBeLessThan(first);
    expect(last).toBeLessThan(25);
  });

  it('Dutch roll after a rudder doublet is damped', () => {
    const sim = trimmed();
    const ac = sim.aircraft, c = sim.controls;
    c.yaw = 1; run(sim, 0.7); c.yaw = -1; run(sim, 0.7); c.yaw = 0;
    let early = 0, late = 0;
    run(sim, 3, () => { early = Math.max(early, Math.abs(ac.beta)); });
    run(sim, 6);
    run(sim, 3, () => { late = Math.max(late, Math.abs(ac.beta)); });
    console.log(`Dutch roll sideslip amplitude ${(early * RAD).toFixed(2)} -> ${(late * RAD).toFixed(2)} deg`);
    expect(late).toBeLessThan(early * 0.4);
  });

  it('roll rate with full aileron at 100 KIAS is 40-90 deg/s', () => {
    const sim = trimmed();
    const ac = sim.aircraft, c = sim.controls;
    c.roll = 1;
    let pMax = 0;
    run(sim, 1.5, () => { pMax = Math.max(pMax, ac.omega.x); });
    console.log(`max roll rate ${(pMax * RAD).toFixed(0)} deg/s`);
    expect(pMax * RAD).toBeGreaterThan(40);
    expect(pMax * RAD).toBeLessThan(90);
  });

  it('adverse yaw: aileron alone yaws the nose against the roll at first', () => {
    const sim = trimmed(70);
    const ac = sim.aircraft, c = sim.controls;
    c.roll = 1;
    run(sim, 0.6);
    // nose yaws left while rolling right: relative wind from the right, beta > 0
    expect(ac.beta).toBeGreaterThan(0.5 * DEG);
  });

  it('propeller effects: right rudder is needed to hold heading at full power, low speed', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    sim.aircraft.placeInFlight(0, 1000, 3000 * FT, 0, 70 * KT, 0);
    sim.controls.throttle = 1;
    const p = new TestPilot(sim);
    run(sim, 30, () => { p.holdSpeedWithPitch(70); p.wingsLevel(0); });
    console.log(`rudder for coordinated full-power climb: ${sim.controls.yaw.toFixed(3)}`);
    expect(sim.controls.yaw).toBeGreaterThan(0.01);
  });

  it('stays numerically sane for 10 minutes with turbulence', () => {
    const sim = trimmed();
    sim.setWeather({ ...sim.weather, windSpeed: 15, gustSpeed: 25, turbulence: 0.6 });
    run(sim, 600);
    const ac = sim.aircraft;
    expect(Number.isFinite(ac.pos.x + ac.pos.y + ac.pos.z + ac.q.w)).toBe(true);
    expect(Math.abs(Math.hypot(ac.q.w, ac.q.x, ac.q.y, ac.q.z) - 1)).toBeLessThan(1e-9);
  });
});
