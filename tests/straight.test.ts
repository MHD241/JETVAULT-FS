// "Aircraft veers left" investigation (see PROJECT_STATE_JETVAULT.md).
// Level runway, zero wind, neutral controls, symmetric loading.
import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run, kt } from './helpers';
import { Vec3, RAD, clamp } from '../src/core/math';
import { C172 } from '../src/sim/aircraft/c172';
import { B738 } from '../src/sim/aircraft/b738';
import { AircraftDef } from '../src/sim/fdm/aircraft';

function setup(def: AircraftDef) {
  const sim = newSim(flatWorld(0), undefined, def);
  sim.spawn({ kind: 'runway', ident: '36' });
  const ac = sim.aircraft;
  if (def === C172) { ac.payload[1] = ac.payload[0]; ac.updateMass(); } // symmetric loading
  expect(Math.abs(ac.cg.y)).toBeLessThan(1e-9);
  return sim;
}
const neutral = (sim: ReturnType<typeof newSim>) => () => { const c = sim.controls; c.pitch = 0; c.roll = 0; c.yaw = 0; };

describe('straight tracking, zero wind, neutral controls', () => {
  it('C172 coasting with the engine off tracks straight (gear, tyres and airframe are symmetric)', () => {
    const sim = setup(C172);
    const ac = sim.aircraft, c = sim.controls;
    c.mags = 'OFF'; c.mixture = 0; c.throttle = 0;
    run(sim, 1);
    ac.vel = new Vec3(15, 0, 0);
    run(sim, 8, neutral(sim));
    console.log(`C172 coast: heading ${(ac.euler[2] * RAD).toFixed(3)} deg, lateral ${ac.pos.y.toFixed(3)} m`);
    expect(Math.abs(ac.euler[2] * RAD)).toBeLessThan(0.2);
    expect(Math.abs(ac.pos.y)).toBeLessThan(0.2);
  });

  it('C172 under power turns left with neutral pedals - caused by propeller slipstream swirl on the fin (physical)', () => {
    const sim = setup(C172);
    sim.controls.throttle = 0.3;
    run(sim, 8, neutral(sim));
    const withSwirl = sim.aircraft.euler[2] * RAD;
    const saved = C172.swirl;
    (C172 as { swirl?: number }).swirl = 0;
    const sim2 = setup(C172);
    sim2.controls.throttle = 0.3;
    run(sim2, 8, neutral(sim2));
    (C172 as { swirl?: number }).swirl = saved;
    const noSwirl = sim2.aircraft.euler[2] * RAD;
    console.log(`C172 30 % power, 8 s: heading change ${withSwirl.toFixed(2)} deg with slipstream swirl, ${noSwirl.toFixed(2)} deg without`);
    expect(withSwirl).toBeLessThan(-2); // left-turning tendency exists
    expect(Math.abs(noSwirl)).toBeLessThan(0.5); // and comes from the swirl term, not a bug elsewhere
  });

  it('C172 under power tracks straight when the pedals hold heading (what the pilot / auto-rudder assist does)', () => {
    const sim = setup(C172);
    const ac = sim.aircraft, c = sim.controls;
    c.throttle = 1;
    let maxPedal = 0;
    run(sim, 14, () => {
      const [, , psi] = ac.euler;
      c.pitch = 0; c.roll = 0;
      c.yaw = clamp(-psi * 6 - ac.q.rotate(ac.omega).z * 2.5, -1, 1);
      maxPedal = Math.max(maxPedal, c.yaw);
    });
    console.log(`C172 full power with heading-hold pedals: hdg ${(ac.euler[2] * RAD).toFixed(2)} deg, lateral ${ac.pos.y.toFixed(2)} m, max right pedal ${maxPedal.toFixed(2)}`);
    expect(Math.abs(ac.euler[2] * RAD)).toBeLessThan(1);
    expect(Math.abs(ac.pos.y)).toBeLessThan(3);
    expect(maxPedal).toBeGreaterThan(0); // right rudder is needed, as on the real aircraft
  });

  it('737-800 taxis straight at taxi thrust with neutral controls (no propeller effects)', () => {
    const sim = setup(B738);
    const ac = sim.aircraft;
    sim.controls.throttle = 0.22; // ~38 % N1 breakaway / taxi thrust
    run(sim, 40, neutral(sim));
    console.log(`737 taxi: ${kt(ac.vel.len()).toFixed(1)} kt, heading ${(ac.euler[2] * RAD).toFixed(3)} deg, lateral ${ac.pos.y.toFixed(3)} m`);
    expect(kt(ac.vel.len())).toBeGreaterThan(5);
    expect(Math.abs(ac.euler[2] * RAD)).toBeLessThan(0.3);
    expect(Math.abs(ac.pos.y)).toBeLessThan(0.5);
  });

  it('737-800 accelerates down the runway to 120 kt without veering (neutral controls)', () => {
    const sim = setup(B738);
    const ac = sim.aircraft;
    sim.controls.throttle = 0.95;
    run(sim, 60, () => { neutral(sim)(); if (kt(ac.cas) > 120) return true; });
    console.log(`737 takeoff run: ${kt(ac.cas).toFixed(0)} KIAS after ${(ac.pos.x).toFixed(0)} m, heading ${(ac.euler[2] * RAD).toFixed(3)} deg, lateral ${ac.pos.y.toFixed(3)} m`);
    expect(kt(ac.cas)).toBeGreaterThan(119);
    expect(Math.abs(ac.euler[2] * RAD)).toBeLessThan(0.3);
    expect(Math.abs(ac.pos.y)).toBeLessThan(0.5);
  });

  it('airborne with neutral controls and trim, the 737 holds wings level (no built-in roll/yaw)', () => {
    const sim = newSim(flatWorld(0), undefined, B738);
    sim.spawnAir(0, -20000, 5000, 0);
    const ac = sim.aircraft;
    run(sim, 30, neutral(sim));
    console.log(`737 hands-off 30 s: bank ${(ac.euler[0] * RAD).toFixed(2)} deg, heading ${(ac.euler[2] * RAD).toFixed(2)} deg, beta ${(ac.beta * RAD).toFixed(3)}`);
    expect(Math.abs(ac.euler[0] * RAD)).toBeLessThan(1);
    expect(Math.abs(ac.euler[2] * RAD)).toBeLessThan(1);
  });
});
