import { describe, it, expect } from 'vitest';
import { ComfortMeter, finalStars, paxCount, passengerComment, PAX_MULT } from '../src/passengers';

const fly = (m: ComfortMeter, secs: number, nz: number, bank: number, pitch: number) => { for (let i = 0; i < secs * 30; i++) m.update(1 / 30, nz, bank, pitch, true); };
describe('passengers', () => {
  it('a smooth flight gets five stars, a rough one fewer', () => {
    const a = new ComfortMeter(); fly(a, 600, 1.02, 10, 6); expect(a.comfort).toBe(100); expect(a.liveStars).toBe(5);
    const b = new ComfortMeter(); fly(b, 600, 1.0, 12, 6); fly(b, 20, 1.0, 45, 5); expect(b.liveStars).toBeLessThan(5); expect(b.liveStars).toBeGreaterThanOrEqual(3);   // twenty seconds at 45 degrees of bank
    const e = new ComfortMeter(); fly(e, 30, 1.0, 60, 5); expect(e.liveStars).toBeLessThanOrEqual(2);       // half a minute at 60 degrees
    const c = new ComfortMeter(); fly(c, 120, 1.5, 20, 8); expect(c.liveStars).toBeLessThanOrEqual(2);                                                                  // two minutes of 0.5 g bumps
    const d = new ComfortMeter(); fly(d, 600, 1.1, 25, 15); fly(d, 60, 1.1, 25, 18); expect(d.liveStars).toBeGreaterThanOrEqual(4);                                                              // normal climb pitch is fine
  });
  it('a firm landing costs a star, a hard one two, never below one', () => {
    const m = new ComfortMeter(); fly(m, 60, 1, 5, 5);
    expect(finalStars(m, 0.9)).toBe(5); expect(finalStars(m, 2.0)).toBe(5); expect(finalStars(m, 3.0)).toBe(4); expect(finalStars(m, 4.5)).toBe(3);
    const r = new ComfortMeter(); fly(r, 300, 1.7, 70, 30); expect(finalStars(r, 5)).toBe(1);
  });
  it('ignores pauses, counts passengers and scales the payout', () => {
    const m = new ComfortMeter(); m.update(2, 3, 80, 40, true); m.update(0, 3, 80, 40, true); expect(m.discomfort).toBe(0);
    expect(paxCount(14250)).toBe(150); expect(paxCount(0)).toBe(0);
    expect(PAX_MULT[1]).toBe(0.5); expect(PAX_MULT[5]).toBe(1.5);
    expect(passengerComment(5, 0.8, new ComfortMeter())).toMatch(/Best landing/);
    const bumpy = new ComfortMeter(); fly(bumpy, 100, 1.5, 0, 0); expect(passengerComment(2, 1.5, bumpy)).toMatch(/bumpy/);
  });
});
