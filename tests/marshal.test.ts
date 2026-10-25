import { describe, it, expect } from 'vitest';
import { marshalCall } from '../src/sim/marshal';

// stand at the origin, nose pointing north (heading 0); the aircraft arrives from the south
const st = { east: 0, north: 0, heading: 0 };
const ac = (east: number, north: number, heading = 0, speed = 3, parkingBrake = false, enginesRunning = true) => ({ east, north, heading, speed, parkingBrake, enginesRunning });

describe('stand marshal', () => {
  it('beckons you ahead on the centreline', () => expect(marshalCall(st, ac(0, -60)).signal).toBe('ahead'));
  it('tells you to turn left when you are right of the centreline', () => {
    const c = marshalCall(st, ac(8, -60));
    expect(c.signal).toBe('left'); expect(c.lateral).toBeGreaterThan(7);
  });
  it('tells you to turn right when you are left of the centreline', () => expect(marshalCall(st, ac(-8, -60)).signal).toBe('right'));
  it('stops asking for a turn once pointed at the line', () => expect(marshalCall(st, ac(8, -60, -0.12)).signal).toBe('ahead'));
  it('says slow near the stop mark', () => expect(marshalCall(st, ac(0, -9, 0, 3)).signal).toBe('slow'));
  it('says stop on the mark, then engines off, then parked', () => {
    expect(marshalCall(st, ac(0, -0.3, 0, 1)).signal).toBe('stop');
    expect(marshalCall(st, ac(0, -0.3, 0, 0, true, true)).signal).toBe('engines');
    expect(marshalCall(st, ac(0, -0.3, 0, 0, true, false)).signal).toBe('brakes');
  });
  it('flags an overshoot', () => expect(marshalCall(st, ac(0, 4)).signal).toBe('overshoot'));
  it('works for any stand heading', () => {
    const s = { east: 100, north: 50, heading: Math.PI / 2 }; // nose east
    expect(marshalCall(s, ac(40, 50, Math.PI / 2)).signal).toBe('ahead');
    expect(marshalCall(s, ac(40, 58, Math.PI / 2)).signal).toBe('right'); // 8 m north of the line, nose east: north is the left -> need to turn right
  });
});
