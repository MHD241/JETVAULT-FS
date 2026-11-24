import { describe, it, expect } from 'vitest';
import { walkable, slide, ZONES, STEPS } from '../src/render/terminalWalk';

describe('terminal walk', () => {
  it('keeps the walker inside the open zones and slides along walls', () => {
    const rects = [ZONES[0]];
    expect(walkable(rects, 2, 0)).toBe(true); expect(walkable(rects, 30, 0)).toBe(false);          // security is closed until check-in is done
    expect(walkable(rects, 25.9, 0)).toBe(false);                                                    // not into the rope
    const [x, z] = slide(rects, 25.5, 0, 0.5, 0.5); expect(x).toBeLessThan(25.8); expect(z).toBeCloseTo(0.5, 5);   // blocked in x, free in z: slides
    const open = [ZONES[0], ZONES[1]]; expect(walkable(open, 30, 0)).toBe(true);
    const [x2] = slide(open, 25.5, 0, 1.0, 0); expect(x2).toBeCloseTo(26.5, 5);                       // through the opening once it is open
  });
  it('has its markers inside the zones they belong to, in order, and the bridge leads to the door', () => {
    STEPS.forEach((s, i) => expect(walkable([ZONES[i]], s.x, s.z)).toBe(true));
    for (let i = 0; i < 3; i++) expect(ZONES[i].x1).toBe(ZONES[i + 1].x0);
    expect(ZONES[3].x1).toBeGreaterThan(90);
  });
});
