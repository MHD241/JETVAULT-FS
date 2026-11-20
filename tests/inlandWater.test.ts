// Inland water (reservoirs, lakes, rivers) is water for the flight model too: a flat surface at the lake level, ground 6 m below it, 'water' surface type,
// and a ditched aircraft floats there. Uses the Heathrow reservoirs (about 25 m above sea level).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { newSim, run, CALM_ISA } from './helpers';
import { loadWorld } from '../src/world/world';
import { World, LC } from '../src/world/world';
import { B738 } from '../src/sim/aircraft/b738';

/** Minimal decoder for the 8-bit greyscale non-interlaced PNGs the land-cover tiles are saved as (tests have no canvas). */
async function decodeGray(buf: ArrayBuffer, n: number): Promise<Uint8Array> {
  const b = Buffer.from(buf); let p = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8); if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); } if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)); const out = new Uint8Array(w * h); const stride = w;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
    for (let x = 0; x < w; x++) {
      const a = x > 0 ? out[y * w + x - 1] : 0, up = y > 0 ? out[(y - 1) * w + x] : 0, ul = x > 0 && y > 0 ? out[(y - 1) * w + x - 1] : 0; let v = raw[row + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const pp = a + up - ul, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      out[y * w + x] = v & 255;
    }
  }
  void n; return out;
}
let world: World; let spot: { e: number; n: number };
beforeAll(async () => {
  world = await loadWorld('public/data/scot', async (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; }, decodeGray, undefined, ['egph', 'egll']); world.setAirport('EGLL');
  // the water cell with the most water around it, in the Heathrow patch
  const c = world.airport.arp, cx = world.patchOf('EGLL')!.cx, cy = world.patchOf('EGLL')!.cy; void c;
  let best = 0; spot = { e: cx, n: cy };
  for (let e = cx - 9000; e <= cx + 9000; e += 60) for (let n = cy - 9000; n <= cy + 9000; n += 60) {
    if (world.landAt(e, n) !== LC.WATER || world.terrain.heightAt(e, n) < 3) continue;
    let k = 0; for (let a = 0; a < 16; a++) if (world.landAt(e + 120 * Math.cos(a * 0.3927), n + 120 * Math.sin(a * 0.3927)) === LC.WATER) k++;
    if (k > best) { best = k; spot = { e, n }; }
  }
});

describe('inland water', () => {
  it('finds a reservoir with a flat level, a 6 m deep bed and the water surface type', () => {
    const lv = world.inlandWaterLevel(spot.e, spot.n);
    console.log('reservoir at', spot.e.toFixed(0), spot.n.toFixed(0), 'level', lv);
    expect(lv).not.toBeNull(); expect(lv!).toBeGreaterThan(5); expect(lv!).toBeLessThan(60);
    expect(world.isWater(spot.e, spot.n)).toBe(true);
    expect(world.groundHeight(spot.e, spot.n)).toBeCloseTo(lv! - 6, 3);
    expect(Math.abs(world.waterSurface(spot.e, spot.n)! - lv!)).toBeLessThan(0.5);   // only small ripples
    expect(world.surfaceAt(spot.e, spot.n).kind).toBe('water');
  });
  it('dry land is not water, and the regional grid alone never makes inland water', () => {
    const rw = world.airport.runways[0].ends[0];
    expect(world.isWater(rw.x, rw.y)).toBe(false); expect(world.waterSurface(rw.x, rw.y)).toBeNull();
    expect(world.inlandWaterLevel(spot.e + 300000, spot.n + 100000)).toBeNull();
  });
  it('an airliner put down on the reservoir floats at the lake level and does not sink to the bed', () => {
    const lv = world.inlandWaterLevel(spot.e, spot.n)!;
    const sim = newSim(world, CALM_ISA, B738);
    sim.spawnAir(spot.e, spot.n, (lv + 5) / 0.3048, 0);
    const ac = sim.aircraft; ac.vel.x = 20; ac.vel.z = 4;
    sim.controls.throttle = 0;
    run(sim, 40);
    console.log('floating at', (-ac.pos.z - lv).toFixed(2), 'm above the lake level, speed', ac.vel.len().toFixed(1));
    expect(-ac.pos.z).toBeGreaterThan(lv - 1.5);   // floating, not on the 6 m deep bed
    expect(-ac.pos.z).toBeLessThan(lv + 3);
  });
});
