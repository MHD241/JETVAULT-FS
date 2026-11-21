import { describe, it, expect } from 'vitest';
import { effectivePixelRatio, AutoScale } from '../src/pixelBudget';

describe('pixel budget', () => {
  it('leaves a normal screen alone and holds a 4.5K iMac to the budget', () => {
    expect(effectivePixelRatio(1920, 1080, 1, 1)).toBe(1);                 // 1080p: 2 MP, under the budget
    expect(effectivePixelRatio(1440, 900, 2, 1)).toBeCloseTo(1.5, 5);       // a 13-inch laptop: 1.3 MP css x 2.25 = 2.9 MP, under the budget
    const r = effectivePixelRatio(2240, 1260, 2, 1);                        // 24-inch iMac (4480 x 2520): 2.8 MP css
    expect(r).toBeLessThan(1.1); expect(2240 * 1260 * r * r).toBeLessThanOrEqual(3.3e6 + 1);
    expect(effectivePixelRatio(2240, 1260, 2, 0.7)).toBeCloseTo(0.7 * 1.5 > 1.0897 ? 1.0897 : 1.05, 2);   // the quality scale still applies below the cap
    expect(effectivePixelRatio(10000, 10000, 2, 1)).toBe(0.5);              // never below 0.5
  });
});
describe('auto scale', () => {
  const run = (a: AutoScale, fps: number, seconds: number) => { let last: number | null = null; for (let i = 0; i < seconds * fps; i++) { const s = a.update(1 / fps); if (s !== null) last = s; } return last; };
  it('steps down when slow, never below the minimum, and recovers when fast', () => {
    const a = new AutoScale();
    expect(run(a, 60, 5)).toBeNull();                       // fast from the start: no change
    run(a, 25, 40); expect(a.scale).toBe(0.55);             // slow for a long time: down to the floor
    run(a, 60, 150); expect(a.scale).toBe(1);               // fast again: back up to full
  });
  it('ignores pauses and hitches', () => {
    const a = new AutoScale(); for (let i = 0; i < 200; i++) a.update(i % 5 === 0 ? 0.8 : 1 / 60); expect(a.scale).toBe(1);
  });
});
