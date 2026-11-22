import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoadMarkings } from '../src/render/roadMarkings';
import { Traffic, polyLengths, pointAt } from '../src/render/traffic';

describe('traffic', () => {
  it('walks along a polyline with the right direction', () => {
    const pts: [number, number][] = [[0, 0], [100, 0], [100, 50]]; const cum = polyLengths(pts);
    expect(cum).toEqual([0, 100, 150]);
    expect(pointAt(pts, cum, 50)).toMatchObject({ e: 50, n: 0, de: 1, dn: 0 });
    expect(pointAt(pts, cum, 125)).toMatchObject({ e: 100, n: 25, de: 0, dn: 1 });
    expect(pointAt(pts, cum, -5).e).toBe(0); expect(pointAt(pts, cum, 999).n).toBe(50);   // clamped at the ends
  });
  it('puts cars on the roads, keeps them on them, on the left, and recycles them when they drive away', () => {
    const rm = new RoadMarkings(() => 0);
    rm.addPatch('p', [['primary', [[0, 0], [600, 0]]], ['motorway', [[0, 100], [600, 100]]]]);
    const t = new Traffic(rm, () => 0, 7, 120); t.count = 100;
    const cam = new THREE.Vector3(300, 50, 0);
    for (let i = 0; i < 400; i++) t.update(1 / 30, cam, 100, 0);
    const mesh = (t as unknown as { mesh: THREE.InstancedMesh }).mesh; expect(mesh.count).toBeGreaterThan(60);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let left = 0, total = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(p, q, s); const n = -p.z;
      const onPrimary = Math.abs(n) < 2.5, onMotorway = Math.abs(n - 100) < 4.5; expect(onPrimary || onMotorway).toBe(true);
      if (onPrimary) { const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q); total++; if ((fwd.x > 0 && n > 0) || (fwd.x < 0 && n < 0)) left++; }   // heading east, left is north (+n): left-hand traffic
      expect(p.y).toBeCloseTo(0.04, 1);
    }
    expect(total).toBeGreaterThan(10); expect(left).toBe(total);   // every car on the primary road drives on its left
    t.update(1 / 30, cam, 500, 0); expect(t.group.visible).toBe(false);   // too high: nothing is simulated or drawn
  });
  it('shows head and tail lights only at night', () => {
    const rm = new RoadMarkings(() => 0); rm.addPatch('p', [['primary', [[0, 0], [600, 0]]]]);
    const t = new Traffic(rm, () => 0, 3, 50); const cam = new THREE.Vector3(300, 30, 0);
    for (let i = 0; i < 100; i++) t.update(1 / 30, cam, 50, 0);
    const lights = (t as unknown as { lights: THREE.Points }).lights; expect(lights.visible).toBe(false);
    t.update(1 / 30, cam, 50, 1); expect(lights.visible).toBe(true);
  });
});
