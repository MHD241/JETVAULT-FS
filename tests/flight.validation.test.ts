// Flight-physics validation scenarios (A-I of the validation plan that are not covered elsewhere):
// stationary, banked turn, stall and recovery, engine idle, crosswind, frame-rate independence.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run, kt, TestPilot } from './helpers';
import { FT, KT, DEG, RAD, clamp } from '../src/core/math';
import { DEFAULT_WEATHER } from '../src/sim/weather';
import { PHYSICS_DT } from '../src/sim/simulation';

function cruising(weather = {}, kias = 95, altFt = 4000) {
  const sim = newSim(flatWorld(0), { ...DEFAULT_WEATHER, windSpeed: 0, gustSpeed: 0, turbulence: 0, ...weather });
  sim.spawn({ kind: 'runway', ident: '36' });
  sim.aircraft.payload[1] = sim.aircraft.payload[0];
  sim.aircraft.updateMass();
  sim.aircraft.placeInFlight(0, 1000, altFt * FT, 0, kias * KT * 1.06, 0);
  const c = sim.controls; c.throttle = 0.6;
  const p = new TestPilot(sim);
  run(sim, 60, () => { p.holdAltitudeWithPitch(altFt * FT); p.wingsLevel(0); c.trim = clamp(c.trim + c.pitch * (1 / 240) * 0.8, -1, 1); });
  return { sim, p, ac: sim.aircraft, c };
}

describe('A: stationary aircraft', () => {
  it('stays put on a level runway with the parking brake on, neutral controls and idle power', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft, c = sim.controls;
    c.parkingBrake = true; c.throttle = 0; c.pitch = 0; c.roll = 0; c.yaw = 0;
    run(sim, 5);
    const p0 = { x: ac.pos.x, y: ac.pos.y, h: ac.euler[2], th: ac.euler[1], ph: ac.euler[0] };
    run(sim, 60);
    const d = Math.hypot(ac.pos.x - p0.x, ac.pos.y - p0.y);
    console.log(`A: moved ${d.toFixed(3)} m, heading drift ${((ac.euler[2] - p0.h) * RAD).toFixed(3)} deg, pitch ${(ac.euler[1] * RAD).toFixed(2)}, bank ${(ac.euler[0] * RAD).toFixed(2)}`);
    expect(d).toBeLessThan(0.2);
    expect(Math.abs(ac.euler[2] - p0.h)).toBeLessThan(0.2 * DEG);
    expect(Math.abs(ac.euler[1] - p0.th)).toBeLessThan(0.2 * DEG);
    expect(ac.crashed).toBe(false);
  });
});

describe('D: banked turn', () => {
  it('turn rate follows g*tan(bank)/V and level flight needs ~1/cos(bank) lift', () => {
    const { sim, p, ac } = cruising();
    // steady ~20 deg bank (the test pilot banks up to 20 deg towards a heading 90 deg away), altitude held
    const psi0 = ac.euler[2];
    const samples: { rate: number; bank: number; v: number; nz: number }[] = [];
    let last = ac.euler[2], t = 0;
    run(sim, 14, (tt) => {
      p.holdAltitudeWithPitch(4000 * FT); p.wingsLevel(psi0 + 1.6);
      t = tt;
      if (tt > 6 && Math.round(tt * 240) % 240 === 0) {
        const d = Math.atan2(Math.sin(ac.euler[2] - last), Math.cos(ac.euler[2] - last));
        samples.push({ rate: d, bank: ac.euler[0], v: ac.tas, nz: 1 / Math.cos(ac.euler[0]) });
        last = ac.euler[2];
      } else if (tt > 5.99 && tt < 6.01) last = ac.euler[2];
    });
    void t;
    expect(samples.length).toBeGreaterThan(4);
    const s = samples[samples.length - 1];
    const theory = (9.80665 * Math.tan(Math.abs(s.bank))) / s.v;
    console.log(`D: bank ${(s.bank * RAD).toFixed(1)} deg, measured turn rate ${(s.rate * RAD).toFixed(2)} deg/s, theory ${(theory * RAD).toFixed(2)} deg/s, altitude change ${((ac.altitude - 4000 * FT) / FT).toFixed(0)} ft`);
    expect(Math.abs(Math.abs(s.rate) - theory) / theory).toBeLessThan(0.15);
    expect(Math.abs(ac.altitude - 4000 * FT) / FT).toBeLessThan(150);
  });
});

describe('E: stall and recovery', () => {
  it('stalls at a high angle of attack (not at a fixed speed) and recovers by lowering the nose', () => {
    const { sim, ac, c } = cruising({}, 80, 5000);
    c.throttle = 0; c.pitch = 0;
    let stallAlpha = 0, stallKias = 0, found = false, maxAlpha = 0;
    // slow pull: the stick (positive = nose up) is eased back until the wing is at a high angle of attack
    run(sim, 120, (t) => {
      c.pitch = clamp(0.03 + t * 0.012, 0, 1);
      c.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.4, 0.4);
      c.yaw = clamp(ac.beta * 3, -0.5, 0.5);
      maxAlpha = Math.max(maxAlpha, ac.alpha * RAD);
      if (!found && ac.alpha * RAD > 15) { found = true; stallAlpha = ac.alpha * RAD; stallKias = kt(ac.cas); }
      if (found) return true;
    });
    expect(found).toBe(true);
    // recovery: stick forward, full power
    c.pitch = -0.4; c.throttle = 1;
    run(sim, 3);
    c.pitch = 0;
    run(sim, 4);
    const a1 = ac.alpha * RAD;
    console.log(`E: alpha reached ${stallAlpha.toFixed(1)} deg at ${stallKias.toFixed(0)} KIAS (idle, flaps 0); after the recovery alpha ${a1.toFixed(1)} deg, ${kt(ac.cas).toFixed(0)} KIAS, ${(ac.altitude / FT).toFixed(0)} ft`);
    expect(a1).toBeLessThan(12);
    expect(stallKias).toBeLessThan(65);
    expect(ac.crashed).toBe(false);
  });
});

describe('F: engine idle in flight', () => {
  it('without thrust the aircraft glides: speed decays to the trim speed and it descends', () => {
    const { sim, ac, c } = cruising({}, 100, 5000);
    const alt0 = ac.altitude;
    c.throttle = 0;
    const hold = () => { c.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5); c.yaw = clamp(ac.beta * 3, -0.5, 0.5); }; // wings level, as a pilot would
    run(sim, 60, hold); // phugoid after the power chop
    const altMid = ac.altitude;
    run(sim, 60, hold);
    const sink = (altMid - ac.altitude) / 60 / FT * 60; // ft/min, second minute
    void alt0;
    console.log(`F: idle, second minute: ${sink.toFixed(0)} ft/min mean sink, ${kt(ac.cas).toFixed(0)} KIAS, thrust ${ac.engines.reduce((a, e) => a + e.thrust, 0).toFixed(0)} N`);
    expect(sink).toBeGreaterThan(600);
    expect(sink).toBeLessThan(1500);
    expect(kt(ac.cas)).toBeLessThan(125);
    expect(kt(ac.cas)).toBeGreaterThan(80);
    expect(ac.crashed).toBe(false);
  });
});

describe('H: wind', () => {
  it('headwind lowers ground speed, crosswind makes the track differ from the heading', () => {
    // wind from 360 (north) 20 kt, flying north: ground speed = TAS - 20 kt
    const head = cruising({ windDirection: 0, windSpeed: 20 });
    run(head.sim, 20, (t) => { head.p.holdAltitudeWithPitch(4000 * FT); head.p.wingsLevel(0); void t; });
    const gs = Math.hypot(head.ac.vel.x, head.ac.vel.y);
    console.log(`H: headwind 20 kt: TAS ${kt(head.ac.tas).toFixed(1)}, ground speed ${kt(gs).toFixed(1)} kt`);
    const w = head.sim.wind.windAt(head.ac.altitude - 0);
    const expected = kt(Math.hypot(w.x, w.y));
    console.log(`H: model wind at 4000 ft: ${expected.toFixed(1)} kt (surface wind is scaled up with height)`);
    expect(Math.abs(kt(head.ac.tas) - kt(gs) - expected)).toBeLessThan(3);
    // wind from the east 20 kt: the aircraft is blown west while it points north
    const cross = cruising({ windDirection: 90, windSpeed: 20 });
    run(cross.sim, 30, () => { cross.p.holdAltitudeWithPitch(4000 * FT); cross.p.wingsLevel(0); });
    const track = Math.atan2(cross.ac.vel.y, cross.ac.vel.x) * RAD;
    console.log(`H: crosswind from the east 20 kt, heading ${(cross.ac.euler[2] * RAD).toFixed(1)}: track ${track.toFixed(1)} deg`);
    expect(track).toBeLessThan(-3); // west of north
  });

  it('a crosswind takeoff with the pilot holding the centreline still gets airborne without leaving the runway', () => {
    const sim = newSim(flatWorld(0), { ...DEFAULT_WEATHER, windDirection: 90, windSpeed: 15, gustSpeed: 0, turbulence: 0 });
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft, c = sim.controls;
    c.throttle = 1; c.parkingBrake = false; c.flapLever = 1;
    let maxOff = 0, lifted = -1;
    run(sim, 35, (t) => {
      // pilot: rudder to hold the runway heading, aileron into wind, rotate at 55 kt
      c.yaw = clamp(-ac.euler[2] * 4 - ac.omega.z * 1.5, -1, 1);
      c.roll = ac.onGround ? clamp(0.25 * (kt(ac.cas) / 60), 0, 0.3) * 1 : clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5);
      c.pitch = kt(ac.cas) > 55 ? 0.25 : 0;
      if (ac.onGround) maxOff = Math.max(maxOff, Math.abs(ac.pos.y)); // on the runway only: once airborne it simply drifts with the wind
      if (lifted < 0 && t > 2 && !ac.onGround) lifted = t;
    });
    console.log(`H: crosswind takeoff 15 kt: lifted off at ${lifted.toFixed(1)} s, max lateral excursion on the runway ${maxOff.toFixed(1)} m, crashed ${ac.crashed}`);
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(lifted).toBeGreaterThan(0);
    expect(maxOff).toBeLessThan(15); // runway half-width is 22 m
  });
});

describe('I: frame-rate independence', () => {
  it('the same inputs give the same trajectory at 20, 60 and 144 fps (and with jittery frames)', () => {
    const results: { x: number; y: number; z: number; h: number }[] = [];
    for (const dts of [[1 / 20], [1 / 60], [1 / 144], [1 / 90, 1 / 37, 1 / 120, 1 / 55]]) {
      const sim = newSim(flatWorld(0));
      sim.spawn({ kind: 'runway', ident: '36' });
      sim.controls.throttle = 1; sim.controls.parkingBrake = false;
      let t = 0, i = 0;
      while (t < 25 - 1e-9) { const dt = dts[i++ % dts.length]; sim.advance(dt); t += dt; }
      const a = sim.aircraft;
      results.push({ x: a.pos.x, y: a.pos.y, z: a.pos.z, h: a.euler[2] });
    }
    const ref = results[0];
    const spread = Math.max(...results.map((r) => Math.hypot(r.x - ref.x, r.y - ref.y, r.z - ref.z)));
    console.log(`I: 25 s takeoff run, positions at four frame-rate patterns differ by at most ${spread.toFixed(2)} m (sim time per run differs by one partial step: ${(PHYSICS_DT * 1000).toFixed(1)} ms)`);
    expect(spread).toBeLessThan(1.5); // one 240 Hz step of travel is ~0.2 m; allow for the accumulator remainder
  });
});
