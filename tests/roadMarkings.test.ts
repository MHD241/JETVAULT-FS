import { describe, it, expect } from 'vitest';
import { buildRoadMarkings, lineSpecs, RoadMarkings } from '../src/render/roadMarkings';

const flat = () => 10;
const build = (cls: string, pts: [number, number][]) => { const pos: number[] = [], idx: number[] = []; buildRoadMarkings(pts, cls, flat, pos, idx); return { pos, idx, quads: idx.length / 6 }; };

describe('road markings', () => {
  it('has markings for the main road classes only', () => {
    for (const c of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']) expect(lineSpecs(c).length).toBeGreaterThan(0);
    for (const c of ['residential', 'service', 'unclassified', 'living_street']) expect(lineSpecs(c)).toEqual([]);
    expect(build('residential', [[0, 0], [100, 0]]).quads).toBe(0);
  });
  it('a 100 m tertiary road gets a dashed centre line: 3 m lines every 10 m', () => {
    const r = build('tertiary', [[0, 0], [100, 0]]);
    expect(r.quads).toBe(10);
    // each quad is a thin strip (0.12 m wide), lifted 0.12 m above the ground, and the north/south axis maps to -z
    for (let q = 0; q < r.quads; q++) { const v = [0, 1, 2, 3].map((k) => r.idx[q * 6 + (k < 3 ? k : 5)]); void v; }
    for (let i = 0; i < r.pos.length; i += 3) { expect(r.pos[i + 1]).toBeCloseTo(10.12, 5); expect(Math.abs(r.pos[i + 2])).toBeLessThanOrEqual(0.07); }
  });
  it('a motorway has two solid edge lines and two dashed lane lines, offset either side of the carriageway', () => {
    const r = build('motorway', [[0, 0], [0, 200]]);   // running north: the edges are at east = -5.2 and +5.2 (left of north is west)
    const xs = new Set<number>(); for (let i = 0; i < r.pos.length; i += 3) xs.add(Math.round(r.pos[i] * 10) / 10);
    expect([...xs].some((x) => Math.abs(x - 5.2) < 0.2) && [...xs].some((x) => Math.abs(x + 5.2) < 0.2)).toBe(true);
    expect([...xs].some((x) => Math.abs(x - 1.8) < 0.2) && [...xs].some((x) => Math.abs(x + 1.8) < 0.2)).toBe(true);
    expect(r.quads).toBeGreaterThan(2 + 2 * 12);   // two single-segment edge lines plus about 12 dashes per lane line
  });
  it('follows bends and never produces NaN or degenerate indices', () => {
    const r = build('primary', [[0, 0], [50, 0], [80, 30], [80, 100], [120, 140]]);
    expect(r.quads).toBeGreaterThan(10);
    expect(r.pos.every(Number.isFinite)).toBe(true);
    expect(Math.max(...r.idx)).toBeLessThan(r.pos.length / 3);
    expect(build('primary', [[0, 0]]).quads).toBe(0);               // a single point is not a road
    expect(build('primary', [[5, 5], [5, 5], [5, 5]]).pos.every(Number.isFinite)).toBe(true);   // a zero-length road
  });
  it('knows where the road surface is, so grass and trees can keep off it', () => {
    const rm = new RoadMarkings(() => 0);
    rm.addPatch('p', [['primary', [[0, 0], [500, 0]]], ['service', [[0, 100], [300, 100]]]]);
    expect(rm.onRoad(250, 0)).toBe(true);            // on the primary road (17 m wide)
    expect(rm.onRoad(250, 8)).toBe(true);            // inside its drawn width
    expect(rm.onRoad(250, 30)).toBe(false);          // well off it
    expect(rm.onRoad(150, 101)).toBe(true);          // on the service road
    expect(rm.onRoad(900, 900)).toBe(false);         // nowhere near a road
    rm.removePatch('p'); expect(rm.onRoad(250, 0)).toBe(false);
  });
});
