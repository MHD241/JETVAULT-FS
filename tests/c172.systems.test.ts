import { describe, it, expect } from 'vitest';
import { flatWorld, newSim, run, TestPilot } from './helpers';
import { FT, KT } from '../src/core/math';

function coldAndDark() {
  const sim = newSim(flatWorld(0));
  sim.spawn({ kind: 'stand', index: 0, coldAndDark: true });
  return sim;
}

describe('engine start and systems', () => {
  it('cold & dark: no electrics, engine stopped, gyros spun down', () => {
    const sim = coldAndDark();
    run(sim, 1);
    expect(sim.aircraft.engine.running).toBe(false);
    expect(sim.systems.busVolts).toBe(0);
    expect(sim.systems.ind.gyrosValid).toBe(false);
  });

  it('will not start without the battery master', () => {
    const sim = coldAndDark();
    const c = sim.controls; c.mags = 'START'; c.mixture = 1; c.throttle = 0.1;
    run(sim, 5);
    expect(sim.aircraft.engine.running).toBe(false);
    expect(sim.aircraft.engine.rpm).toBeLessThan(5);
  });

  it('will not start with the mixture at idle cut-off', () => {
    const sim = coldAndDark();
    const c = sim.controls; c.masterBattery = true; c.mags = 'START'; c.mixture = 0; c.throttle = 0.1;
    run(sim, 6);
    expect(sim.aircraft.engine.running).toBe(false);
    expect(sim.aircraft.engine.rpm).toBeGreaterThan(150); // cranking
  });

  it('normal start: cranks then runs; idles at 600-800 rpm; alternator charges above ~900 rpm', () => {
    const sim = coldAndDark();
    const ac = sim.aircraft, c = sim.controls;
    c.masterBattery = true; c.mixture = 1; c.throttle = 0.1; c.mags = 'START';
    let started = -1;
    run(sim, 8, (t) => { if (ac.engine.running && started < 0) { started = t; c.mags = 'BOTH'; } });
    expect(started).toBeGreaterThan(1);
    expect(started).toBeLessThan(5);
    c.masterAlternator = true; c.throttle = 0;
    run(sim, 20);
    expect(ac.engine.rpm).toBeGreaterThan(600);
    expect(ac.engine.rpm).toBeLessThan(800);
    expect(sim.systems.ind.ammeterA).toBeLessThan(0); // discharging at idle
    c.throttle = 0.25;
    run(sim, 10);
    expect(ac.engine.rpm).toBeGreaterThan(1000);
    expect(sim.systems.busVolts).toBeCloseTo(28, 0);
    // vacuum gyros spin up
    run(sim, 120);
    expect(sim.systems.ind.gyrosValid).toBe(true);
    expect(sim.systems.ind.vacuumInHg).toBeGreaterThan(4.5);
  });

  it('static full-throttle rpm is within the C172S 2300-2420 rpm range', () => {
    const sim = coldAndDark();
    const ac = sim.aircraft, c = sim.controls;
    c.masterBattery = true; c.mixture = 1; c.throttle = 0.1; c.mags = 'START';
    run(sim, 6, () => { if (ac.engine.running) c.mags = 'BOTH'; });
    c.mags = 'BOTH'; c.throttle = 1;
    run(sim, 10);
    expect(ac.engine.rpm).toBeGreaterThan(2300);
    expect(ac.engine.rpm).toBeLessThan(2420);
    // magneto check: single mag drops 25-175 rpm
    const both = ac.engine.rpm;
    c.mags = 'L'; run(sim, 4);
    const drop = both - ac.engine.rpm;
    expect(drop).toBeGreaterThan(25);
    expect(drop).toBeLessThan(175);
  });

  it('mixture to idle cut-off stops the engine; mags OFF stops the engine', () => {
    for (const kill of ['mixture', 'mags'] as const) {
      const sim = newSim(flatWorld(0));
      sim.spawn({ kind: 'runway', ident: '36' });
      sim.controls.parkingBrake = true;
      run(sim, 2);
      expect(sim.aircraft.engine.running).toBe(true);
      if (kill === 'mixture') sim.controls.mixture = 0; else sim.controls.mags = 'OFF';
      run(sim, 10);
      expect(sim.aircraft.engine.running).toBe(false);
      expect(sim.aircraft.engine.rpm).toBeLessThan(50);
    }
  });

  it('fuel selector OFF starves the engine after the lines empty; fuel is consumed', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    sim.controls.parkingBrake = true; sim.controls.throttle = 1;
    const f0 = sim.aircraft.fuel[0] + sim.aircraft.fuel[1];
    run(sim, 60);
    const burned = f0 - (sim.aircraft.fuel[0] + sim.aircraft.fuel[1]);
    // ~12 gph at static full power -> ~0.6 kg/min
    expect(burned).toBeGreaterThan(0.4);
    expect(burned).toBeLessThan(0.8);
    sim.controls.fuelSelector = 'OFF';
    run(sim, 60);
    expect(sim.aircraft.engine.running).toBe(false);
  });

  it('instruments read the simulated state: IAS, altitude (QNH), VSI, attitude', () => {
    const sim = newSim(flatWorld(0));
    sim.spawn({ kind: 'runway', ident: '36' });
    sim.aircraft.placeInFlight(0, 1000, 3000 * FT, 0, 100 * KT, 0);
    sim.controls.throttle = 0.7;
    const p = new TestPilot(sim);
    run(sim, 40, () => { p.holdAltitudeWithPitch(3000 * FT); p.wingsLevel(0); });
    const ind = sim.systems.ind;
    expect(Math.abs(ind.altitudeFt - 3000)).toBeLessThan(30);
    expect(Math.abs(ind.vsiFpm)).toBeLessThan(100);
    expect(Math.abs(ind.iasKt - sim.aircraft.cas / KT)).toBeLessThan(3);
    expect(Math.abs(ind.pitchDeg - sim.aircraft.euler[1] * 57.3)).toBeLessThan(1);
    // a different Kollsman setting shifts the altimeter by ~27-30 ft/hPa
    const alt0 = ind.altitudeFt;
    sim.controls.kollsman = 1023.25;
    run(sim, 0.5, () => { p.holdAltitudeWithPitch(3000 * FT); p.wingsLevel(0); });
    const shift = sim.systems.ind.altitudeFt - alt0;
    expect(shift).toBeGreaterThan(250);
    expect(shift).toBeLessThan(320);
  });
});
