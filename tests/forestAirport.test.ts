// No trees in the airport space: inside the fence, 120 m around it, or within 220 m of a runway; trees still allowed far away.
import { it, expect } from 'vitest';
import { loadEGPH } from './helpers';
import { Forest } from '../src/render/forest';
it('forest keeps out of the airport space', async () => {
  const w = await loadEGPH(); const f = new Forest(w, 3200, 9) as unknown as { inAirport(e: number, n: number): boolean };
  const [a, b] = w.airport.runways[0].ends, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  expect(f.inAirport(mx, my)).toBe(true);
  for (const [x, y] of w.airport.boundary) expect(f.inAirport(x, y)).toBe(true);
  expect(f.inAirport(mx + 6000, my)).toBe(false);
});
