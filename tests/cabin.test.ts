import { describe, it, expect } from 'vitest';
import { cabinSpec, seatsOf, seatChoices, eyeOf, floorZ, halfWidth } from '../src/render/cabin';
import { A320 } from '../src/sim/aircraft/airliners';

describe('cabin layout', () => {
  const spec = cabinSpec("a320", A320.hull!.x0, A320.hull!.x1, A320.hull!.radius);
  it('puts every seat inside the cabin, in rows of the aircraft\'s real layout', () => {
    const seats = seatsOf(spec), hw = halfWidth(spec);
    expect(seats.length % 6).toBe(0); expect(seats.length).toBeGreaterThan(120); expect(seats.length).toBeLessThan(200);   // 3-3 rows: an A320 has 150-180 seats
    for (const s of seats) { expect(Math.abs(s.y)).toBeLessThan(hw); expect(s.x).toBeGreaterThan(spec.x0); expect(s.x).toBeLessThan(spec.x1); }
    const r1 = seats.filter((s) => s.row === 1); expect(r1.map((s) => s.letter).join('')).toBe('ABCDEF'); expect(r1.filter((s) => s.window).length).toBe(2); expect(r1.filter((s) => s.aisle).length).toBe(2);
    expect(new Set(seats.map((s) => `${s.row}${s.letter}`)).size).toBe(seats.length);   // no duplicates
  });
  it('has a sensible eye height and a list of seats to choose from', () => {
    const c = seatChoices(spec); expect(c.length).toBeGreaterThanOrEqual(8);
    for (const x of c) { const e = eyeOf(spec, x.seat); expect(e[2]).toBeCloseTo(floorZ(spec) - 1.1, 5); expect(Math.abs(e[1])).toBeLessThan(halfWidth(spec)); }
    expect(c.some((x) => x.seat.window && x.seat.y < 0)).toBe(true); expect(c.some((x) => x.seat.window && x.seat.y > 0)).toBe(true);
  });
  it('knows the other layouts: 2-4-2, 3-3-3 and cargo side seats', () => {
    const w = (id: string, a: number, b: number, r: number) => seatsOf(cabinSpec(id, a, b, r));
    expect(w('a340', -37.7, 37.7, 2.8).filter((s) => s.row === 1).length).toBe(8); expect(w('a350', -36.9, 36.9, 2.98).filter((s) => s.row === 1).length).toBe(9);
    const c17 = w('c17', -26, 26, 2.9); expect(c17.length).toBeGreaterThan(20); expect(c17.every((s) => s.window)).toBe(true);
  });
});
