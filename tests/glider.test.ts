// Glider flight model: glide polar, stall, airbrakes, ground handling.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { GLIDER } from '../src/sim/aircraft/glider';
import { KT, DEG, clamp, Vec3 } from '../src/core/math';
import { Buggy } from '../src/sim/buggy';

function glideSim(speedKt: number) {
  const sim = newSim(flatWorld(0), undefined, GLIDER);
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft;
  ac.placeInFlight(0, 0, 2500, 0, speedKt * KT, -2 * DEG);
  sim.controls.gearDown = true; sim.controls.throttle = 0;
  return { sim, ac };
}

/** Hold calibrated airspeed with the elevator (speed -> pitch -> elevator cascade). */
function hold(sim: ReturnType<typeof glideSim>['sim'], kt: number) {
  const ac = sim.aircraft;
  let thetaRef = ac.euler[1];
  return () => {
    const dv = ac.cas / KT - kt;
    thetaRef = clamp(thetaRef + dv * 0.002 * DEG, -25 * DEG, 20 * DEG);
    sim.controls.pitch = clamp(2.5 * (thetaRef + dv * 0.3 * DEG - ac.euler[1]) - 1.2 * ac.omega.y, -0.8, 0.8);
    sim.controls.roll = clamp(-2 * ac.euler[0] - 1 * ac.omega.x, -0.5, 0.5);
    sim.controls.yaw = clamp(-ac.beta * 3, -0.5, 0.5);
  };
}

describe('retrieval tow', () => {
  it('a buggy tows the parked glider across the field on a slack-capable rope without upsetting it', () => {
    const sim = newSim(flatWorld(0), undefined, GLIDER);
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft;
    run(sim, 2, () => {});
    const b = new Buggy();
    const nose = ac.worldPoint(ac.def.hook!);
    b.place(ac.pos.y, nose.x + 5, 0); // just ahead of the nose, same heading
    b.towing = true;
    const n0 = ac.pos.x;
    ac.cable = { anchor: new Vec3(0, 0, 0), vTarget: 0, tMax: 3000, t: 0, tow: true };
    let maxLat = 0;
    run(sim, 60, () => {
      b.step(1 / 240, 5, 0.1 * Math.sin(sim.simTime * 0.3), false);
      const h = b.hitch();
      ac.cable!.anchor = new Vec3(h.north, h.east, -0.7);
      ac.cable!.vTarget = b.speed;
      maxLat = Math.max(maxLat, Math.hypot(ac.pos.y - b.east, ac.pos.x - b.north));
    });
    const gap = Math.hypot(ac.pos.y - b.east, ac.pos.x - b.north);
    console.log(`tow: buggy ${b.north.toFixed(0)} m north, glider moved ${(ac.pos.x - n0).toFixed(0)} m, gap ${gap.toFixed(1)} m, max gap ${maxLat.toFixed(1)}`);
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(ac.pos.x - n0).toBeGreaterThan(100);
    expect(gap).toBeLessThan(14);
  });
});

describe('glider polar', () => {
  const rows: string[] = [];
  const polar: Record<number, { sink: number; ld: number }> = {};
  for (const kt of [36, 40, 44, 50, 56, 65, 80, 95]) {
    it(`steady glide at ${kt} KIAS`, () => {
      const { sim, ac } = glideSim(kt);
      const ctl = hold(sim, kt);
      run(sim, 20, ctl);
      const p0 = ac.pos.clone();
      const e0 = ac.altitude + (ac.tas * ac.tas) / (2 * 9.80665);
      const t0 = 30;
      run(sim, t0, ctl);
      // energy-height sink rate removes the phugoid exchange of speed and height
      const sink = (e0 - (ac.altitude + (ac.tas * ac.tas) / (2 * 9.80665))) / t0;
      const gs = Math.hypot(ac.pos.x - p0.x, ac.pos.y - p0.y) / t0;
      polar[kt] = { sink, ld: gs / sink };
      rows.push(`${kt} kt: sink ${sink.toFixed(2)} m/s, L/D ${(gs / sink).toFixed(1)}, pitch ${(ac.euler[1] / DEG).toFixed(1)}`);
      expect(ac.crashed).toBe(false);
    });
  }
  it('prints the polar', () => { console.log('\n' + rows.join('\n')); });
});

describe('glider handling', () => {
  it('cannot hold level 1 g flight much below ~35 KIAS (stall), but can at 40', () => {
    const sinkAt = (kt: number) => {
      const { sim, ac } = glideSim(kt + 8);
      const ctl = hold(sim, kt);
      run(sim, 20, ctl);
      const e0 = ac.altitude + (ac.tas * ac.tas) / (2 * 9.80665);
      run(sim, 15, ctl);
      return { sink: (e0 - (ac.altitude + (ac.tas * ac.tas) / (2 * 9.80665))) / 15, cas: ac.cas / KT };
    };
    const a = sinkAt(40), b = sinkAt(31);
    console.log(`glider hold 40 kt: sink ${a.sink.toFixed(2)} m/s (cas ${a.cas.toFixed(0)}); hold 31 kt: sink ${b.sink.toFixed(2)} m/s (cas ${b.cas.toFixed(0)})`);
    expect(a.sink).toBeLessThan(1.1);
    expect(b.sink).toBeGreaterThan(a.sink * 1.8);
  });

  it('airbrakes steepen the glide a lot', () => {
    const { sim, ac } = glideSim(55);
    const ctl = hold(sim, 55);
    run(sim, 15, ctl);
    sim.controls.speedbrake = 1;
    run(sim, 15, ctl);
    const p0 = ac.pos.clone();
    const e0 = ac.altitude + (ac.tas * ac.tas) / (2 * 9.80665);
    run(sim, 15, ctl);
    const sink = (e0 - (ac.altitude + (ac.tas * ac.tas) / (2 * 9.80665))) / 15;
    const ld = Math.hypot(ac.pos.x - p0.x, ac.pos.y - p0.y) / 15 / sink;
    console.log(`glider airbrakes out at 55 kt: sink ${sink.toFixed(1)} m/s, L/D ${ld.toFixed(1)}`);
    expect(ld).toBeLessThan(12);
    expect(ld).toBeGreaterThan(3);
  });

  it('sits on its wheels, rolls straight when pulled by the winch and climbs away', () => {
    const sim = newSim(flatWorld(0), undefined, GLIDER);
    sim.spawn({ kind: 'runway', ident: '36' });
    const ac = sim.aircraft;
    run(sim, 3, () => {});
    expect(ac.onGround).toBe(true);
    expect(Math.hypot(ac.vel.x, ac.vel.y)).toBeLessThan(0.2);
    const h0 = ac.euler[2];
    expect(sim.startWinch()).toBe(true);
    let maxAgl = 0, maxKt = 0, release = -1;
    run(sim, 45, () => {
      sim.controls.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5);
      // pilot: keep the nose near 12 deg once flying, then ease it
      const target = !ac.cable ? 0 : ac.agl > 8 ? 40 * DEG : 6 * DEG;
      sim.controls.pitch = clamp(6 * (target - ac.euler[1]) - 1.5 * ac.omega.y, -0.8, 0.8) * (ac.cas / KT > 30 ? 1 : 0);
      maxAgl = Math.max(maxAgl, ac.agl); if (ac.cable) maxKt = Math.max(maxKt, ac.cas / KT);
      if (!ac.cable && release < 0) release = sim.simTime;
    });
    console.log(`winch launch: top ${maxAgl.toFixed(0)} m AGL, max ${maxKt.toFixed(0)} kt, cable cut at ${release.toFixed(0)} s, heading change ${(((ac.euler[2] - h0) / DEG)).toFixed(1)} deg`);
    expect(ac.crashed, ac.crashReason).toBe(false);
    expect(maxAgl).toBeGreaterThan(150);
    expect(maxKt).toBeLessThan(75);
  });
});

import { LiftField } from '../src/sim/lift';
import { WindModel, DEFAULT_WEATHER } from '../src/sim/weather';
import { AutoTrim } from '../src/sim/assists';

describe('lift field', () => {
  const mk = (over: Partial<typeof DEFAULT_WEATHER>, h: (e: number, n: number) => number = () => 0) => {
    const w = { ...DEFAULT_WEATHER, ...over };
    return new LiftField({ heightAt: h }, () => w, new WindModel(w, 3), () => 100);
  };
  it('has thermals by day (cores of +2 m/s or more, sink between) and none at night', () => {
    const day = mk({ timeOfDay: 13, cloudCover: 'FEW', windSpeed: 4 });
    let max = -9, min = 9;
    for (let n = -5000; n < 5000; n += 60) for (let e = -5000; e < 5000; e += 60) { const w = day.at(n, e, 900, 500); max = Math.max(max, w); min = Math.min(min, w); }
    const night = mk({ timeOfDay: 2 });
    let nmax = -9;
    for (let n = -3000; n < 3000; n += 100) for (let e = -3000; e < 3000; e += 100) nmax = Math.max(nmax, Math.abs(night.at(n, e, 900, 500)));
    console.log(`thermals at 500 m AGL: max ${max.toFixed(1)} m/s, min ${min.toFixed(1)} m/s; night max |w| ${nmax.toFixed(2)}`);
    expect(max).toBeGreaterThan(2);
    expect(min).toBeLessThan(-0.2);
    expect(nmax).toBeLessThan(0.05);
  });
  it('gives ridge lift on the windward slope and sink on the lee side', () => {
    // wind from 270 (blowing east); a ridge peaking at east = 0, 0.25 slope each side
    const ridge = (e: number) => Math.max(0, 300 - 0.25 * Math.abs(e));
    const f = mk({ windDirection: 270, windSpeed: 15, timeOfDay: 2 }, (e) => ridge(e));
    const up = f.at(0, -150, 400, 60), lee = f.at(0, 150, 400, 60);
    console.log(`ridge lift windward ${up.toFixed(2)} m/s, lee ${lee.toFixed(2)} m/s`);
    expect(up).toBeGreaterThan(1);
    expect(lee).toBeLessThan(0);
  });
});

describe('glider auto-trim', () => {
  it('holds the airspeed at stick release', () => {
    const { sim, ac } = glideSim(52);
    const at = new AutoTrim();
    let minK = 99, maxK = 0;
    run(sim, 90, () => {
      sim.controls.roll = clamp(-2 * ac.euler[0] - ac.omega.x, -0.5, 0.5);
      sim.controls.yaw = clamp(-ac.beta * 3, -0.5, 0.5);
      sim.controls.pitch = sim.simTime < 2 ? 0 : at.update(1 / 240, ac, sim.controls, 0);
      if (sim.simTime > 30) { minK = Math.min(minK, ac.cas / KT); maxK = Math.max(maxK, ac.cas / KT); }
    });
    console.log(`glider auto-trim: airspeed ${minK.toFixed(1)}..${maxK.toFixed(1)} kt after 30 s`);
    expect(minK).toBeGreaterThan(44);
    expect(maxK).toBeLessThan(60);
    expect(ac.crashed).toBe(false);
  });
});
