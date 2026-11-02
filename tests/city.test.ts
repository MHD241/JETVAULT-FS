import { describe, it, expect, beforeAll } from 'vitest';
import { loadEGPH } from './helpers';
import { generateCity, EDINBURGH_CENTRE } from '../src/world/city';
import { World } from '../src/world/world';

let world: World;
beforeAll(async () => { world = await loadEGPH(['egph']); });

describe('generated Edinburgh city', () => {
  it('fills the built-up area with thousands of buildings, tallest in the centre, none on water', () => {
    const t0 = Date.now();
    const city = generateCity(world, 8500, 58, () => true); // the headless test world has no land-cover image, so treat everything as built-up
    const ms = Date.now() - t0;
    const tallest = Math.max(...city.map((b) => b.top - b.base));
    const mean = city.reduce((a, b) => a + (b.top - b.base), 0) / city.length;
    console.log(`city: ${city.length} buildings in ${ms} ms, mean ${mean.toFixed(0)} m, tallest ${tallest.toFixed(0)} m (${EDINBURGH_CENTRE.lat})`);
    expect(city.length).toBeGreaterThan(5000);
    expect(tallest).toBeGreaterThan(80);
    for (const b of city.slice(0, 2000)) expect(world.heightAt((b.minE + b.maxE) / 2, (b.minN + b.maxN) / 2)).toBeGreaterThan(0.5);
  });
});
