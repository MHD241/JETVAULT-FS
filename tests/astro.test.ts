// Sun and moon for the place and time (the game computes them for wherever the aircraft is).
import { describe, it, expect } from 'vitest';
import { sunPosition, moonPosition } from '../src/render/environment';
import { clockNow, DEFAULT_WEATHER } from '../src/sim/weather';

describe('astronomy', () => {
  it('the sun is high in Edinburgh and below the horizon in Sydney at the same instant', () => {
    const edi = sunPosition(55.95, -3.37, 172, 12), syd = sunPosition(-33.87, 151.2, 172, 12);
    expect(edi.elevation).toBeGreaterThan(50); expect(edi.elevation).toBeLessThan(60);
    expect(syd.elevation).toBeLessThan(-10);
  });
  it('the moon phase matches known new and full moons', () => {
    const full = moonPosition(55.95, -3.37, Date.UTC(2024, 0, 25, 17, 54)), nw = moonPosition(55.95, -3.37, Date.UTC(2024, 0, 11, 11, 57));
    expect(full.illum).toBeGreaterThan(0.97); expect(nw.illum).toBeLessThan(0.03);
    const first = moonPosition(0, 0, Date.UTC(2024, 0, 18, 3, 52));          // first quarter: waxing, half lit
    expect(first.waxing).toBe(true); expect(Math.abs(first.illum - 0.5)).toBeLessThan(0.08);
  });
  it('a full moon is up at night: roughly opposite the sun in the sky', () => {
    const ms = Date.UTC(2024, 0, 25, 23, 0), m = moonPosition(55.95, -3.37, ms), s = sunPosition(55.95, -3.37, 25, 23);
    expect(m.elevation).toBeGreaterThan(20); expect(s.elevation).toBeLessThan(-10);
  });
  it('real-time mode follows the real clock, manual mode the chosen time', () => {
    const a = clockNow({ ...DEFAULT_WEATHER, realTime: true }, 0), b = clockNow({ ...DEFAULT_WEATHER, realTime: false, timeOfDay: 6, dayOfYear: 100 }, 0);
    expect(Math.abs(a.ms - Date.now())).toBeLessThan(2000);
    expect(b.utc).toBe(6); expect(b.day).toBe(100);
  });
});
