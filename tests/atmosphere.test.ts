import { describe, it, expect } from 'vitest';
import { airAt, pressureAltitude, casFromImpactPressure, impactPressure, indicatedAltitude } from '../src/sim/atmosphere';
import { LocalProjection } from '../src/world/geo';

describe('ISA atmosphere', () => {
  // ICAO standard atmosphere reference values
  const table: [number, number, number, number][] = [
    // h (m), T (K), p (Pa), rho (kg/m3)
    [0, 288.15, 101325, 1.225],
    [1000, 281.65, 89876, 1.1117],
    [3000, 268.65, 70121, 0.9093],
    [5000, 255.65, 54048, 0.7364],
    [11000, 216.65, 22632, 0.3639],
    [15000, 216.65, 12045, 0.1937],
  ];
  it.each(table)('h=%d m matches the standard table', (h, T, p, rho) => {
    const a = airAt(h);
    expect(a.temperature).toBeCloseTo(T, 1);
    expect(Math.abs(a.pressure - p) / p).toBeLessThan(0.001);
    expect(Math.abs(a.density - rho) / rho).toBeLessThan(0.002);
  });

  it('pressure altitude inverts the standard pressure', () => {
    for (const h of [0, 500, 2500, 8000]) expect(pressureAltitude(airAt(h).pressure)).toBeCloseTo(h, 0);
  });

  it('altimeter reads field elevation when set to QNH', () => {
    const cond = { seaLevelPressure: 99500, isaDeviation: 0 };
    const p = airAt(41, cond).pressure;
    expect(indicatedAltitude(p, 99500)).toBeCloseTo(41, 0);
  });

  it('CAS equals TAS at sea level and is lower than TAS at altitude', () => {
    const sl = airAt(0);
    expect(casFromImpactPressure(impactPressure(60, sl))).toBeCloseTo(60, 2);
    const hi = airAt(2438);
    const cas = casFromImpactPressure(impactPressure(60, hi));
    expect(cas).toBeLessThan(60);
    expect(cas).toBeCloseTo(60 * Math.sqrt(hi.density / 1.225), 0);
  });
});

describe('local projection', () => {
  const proj = new LocalProjection(55.950145, -3.372288);
  it('round-trips lat/lon within 1 mm over the region', () => {
    for (const [lat, lon] of [[55.95, -3.37], [56.2, -3.0], [55.6, -4.5], [56.9, -1.6]]) {
      const { east, north } = proj.forward(lat, lon);
      const ll = proj.inverse(east, north);
      expect(Math.abs(ll.lat - lat)).toBeLessThan(1e-8);
      expect(Math.abs(ll.lon - lon)).toBeLessThan(1e-8);
    }
  });
  it('matches the pipeline (pyproj) position of the runway 06 threshold', () => {
    const { east, north } = proj.forward(55.944, -3.39014);
    expect(east).toBeCloseTo(-1115.4458, 2);
    expect(north).toBeCloseTo(-684.0457, 2);
  });
});
