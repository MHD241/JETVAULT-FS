import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PeopleField, rng } from '../src/render/people';
import { Cabin, cabinSpec } from '../src/render/cabin';
import { A320 } from '../src/sim/aircraft/airliners';

// the cabin makes a canvas for its screens: a no-op 2D context is enough here
const noop: unknown = new Proxy(function () { /* no-op */ }, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() { /* no-op */ } }) : noop), apply: () => noop, set: () => true });
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };

describe('people and passengers', () => {
  it('walkers stay on their path and turn round at its ends; standing and seated people are counted separately', () => {
    const pf = new PeopleField([{ x: 0, z: 0, yaw: 0, cloth: 1, skin: 1, path: [[0, 0], [10, 0]], speed: 2, t: 0 }, { x: 3, z: 3, yaw: 0, cloth: 2, skin: 2 }, { x: 5, z: 5, y: 0.47, yaw: 0, cloth: 3, skin: 3, seated: true }]);
    const standing = (pf as unknown as { standing: THREE.InstancedMesh }).standing, seated = (pf as unknown as { seatedBody: THREE.InstancedMesh }).seatedBody;
    expect(standing.count).toBe(2); expect(seated.count).toBe(1);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); let maxX = -1, minX = 99;
    for (let i = 0; i < 400; i++) { pf.update(0.1); standing.getMatrixAt(0, m); p.setFromMatrixPosition(m); maxX = Math.max(maxX, p.x); minX = Math.min(minX, p.x); expect(p.z).toBeCloseTo(0, 5); }
    expect(maxX).toBeGreaterThan(9.5); expect(maxX).toBeLessThanOrEqual(10.0001); expect(minX).toBeLessThan(0.5); expect(minX).toBeGreaterThanOrEqual(-0.0001);   // ping-pong between 0 and 10
  });
  it('the random generator repeats for the same seed', () => { const a = rng(5), b = rng(5); expect([a(), a(), a()]).toEqual([b(), b(), b()]); });
  it('the cabin seats about two thirds of its seats, never the player\'s, and has two wings', () => {
    const cab = new Cabin(cabinSpec('a320', A320.hull!.x0, A320.hull!.x1, A320.hull!.radius)); cab.addWings(); cab.addPassengers(6, 0, 3);
    const n = (cab.pax as unknown as { people: unknown[] }).people.length, total = cab.seats.length;
    expect(n).toBeGreaterThan(total * 0.55); expect(n).toBeLessThan(total * 0.75);
    expect((cab.pax as unknown as { people: { x: number; z: number }[] }).people.some((p) => { const s = cab.seats.find((q) => q.row === 6 && q.col === 0)!; return Math.abs(p.x - s.x) < 0.05 && Math.abs(p.z - s.y) < 0.05; })).toBe(false);
    cab.addPassengers(7, 1, 3); expect(cab.group.children.filter((c) => c === cab.pax!.group).length).toBe(1);   // re-seating replaces the crowd, it does not add to it
  });
});
