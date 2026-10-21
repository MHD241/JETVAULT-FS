import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run } from './helpers';
import { FT, KT, RAD } from '../src/core/math';

function cruise() {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'runway', ident: '36' });
  sim.aircraft.placeInFlight(0, 1000, 3000 * FT, 0, 105 * KT, 0);
  sim.controls.throttle = 0.65;
  run(sim, 2);
  return sim;
}

describe('KAP 140-style autopilot (flies through the servos, not the state)', () => {
  it('ALT hold keeps altitude within 50 ft for 3 minutes in light turbulence', () => {
    const sim = cruise();
    sim.setWeather({ ...sim.weather, turbulence: 0.3, windSpeed: 12 });
    sim.autopilot.engage(sim.systems);
    sim.autopilot.holdAltitude(sim.systems);
    const target = sim.autopilot.targetAltFt;
    run(sim, 20);
    let maxErr = 0;
    run(sim, 180, () => { maxErr = Math.max(maxErr, Math.abs(sim.systems.ind.altitudeFt - target)); });
    console.log(`ALT hold max error ${maxErr.toFixed(0)} ft`);
    expect(sim.autopilot.engaged).toBe(true);
    expect(maxErr).toBeLessThan(50);
  });

  it('HDG mode turns 90 degrees onto the bug and holds it, banking no more than ~20 deg', () => {
    const sim = cruise();
    sim.autopilot.engage(sim.systems);
    sim.autopilot.holdAltitude(sim.systems);
    sim.autopilot.lateral = 'HDG';
    sim.controls.headingBug = (sim.systems.ind.headingDeg + 90) % 360;
    let maxBank = 0;
    run(sim, 90, () => { maxBank = Math.max(maxBank, Math.abs(sim.aircraft.euler[0])); });
    let err = sim.controls.headingBug - sim.systems.ind.headingDeg;
    err = ((err + 540) % 360) - 180;
    console.log(`HDG: error ${err.toFixed(1)} deg, max bank ${(maxBank * RAD).toFixed(1)}`);
    expect(Math.abs(err)).toBeLessThan(3);
    expect(maxBank * RAD).toBeLessThan(23);
  });

  it('VS mode climbs at the selected rate', () => {
    const sim = cruise();
    sim.controls.throttle = 1;
    sim.autopilot.engage(sim.systems);
    sim.autopilot.targetVsFpm = 500;
    run(sim, 30);
    const a0 = sim.aircraft.altitude;
    run(sim, 60);
    const vs = ((sim.aircraft.altitude - a0) / FT);
    console.log(`VS 500 selected: achieved ${vs.toFixed(0)} fpm`);
    expect(Math.abs(vs - 500)).toBeLessThan(80);
  });

  it('pilot input on the yoke disconnects it', () => {
    const sim = cruise();
    sim.autopilot.engage(sim.systems);
    sim.controls.pitch = 0.9;
    run(sim, 0.1);
    expect(sim.autopilot.engaged).toBe(false);
    expect(sim.autopilot.disconnectReason).toMatch(/override/i);
  });
});
