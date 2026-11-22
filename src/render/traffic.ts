// Cars: a few hundred low-poly cars drive on the roads around the camera (one InstancedMesh, so it costs almost nothing). Left-hand traffic, speeds by road class,
// motorways with three lanes in one direction. At night their headlights (white, in front) and tail lights (red, behind) show as small glowing points. Cars are
// only simulated near the camera and while you are low (under 400 m): there is nothing to see from higher up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadMarkings } from './roadMarkings';

/** Speeds (m/s) by road class: roughly 30 mph in streets up to 70 mph on motorways. */
export const SPEED: Record<string, number> = { motorway: 29, trunk: 24, primary: 17, secondary: 14, tertiary: 12, residential: 8, unclassified: 10, living_street: 4, service: 4 };
/** Half a lane (m): how far from the road's centre line a car drives. */
export const LANE: Record<string, number> = { trunk: 1.9, primary: 1.8, secondary: 1.7, tertiary: 1.5, residential: 1.4, unclassified: 1.4, living_street: 1.2, service: 1.2 };
const MOTORWAY_LANES = [-3.65, 0, 3.65];

/** Cumulative lengths of a polyline. */
export function polyLengths(pts: [number, number][]): number[] { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }
/** Position and travel direction (east, north, unit) at distance `s` along a polyline (clamped to its ends). */
export function pointAt(pts: [number, number][], cum: number[], s: number): { e: number; n: number; de: number; dn: number } {
  const L = cum[cum.length - 1]; s = Math.max(0, Math.min(L, s));
  let i = 0; while (i < pts.length - 2 && cum[i + 1] < s) i++;
  const seg = cum[i + 1] - cum[i] || 1, u = (s - cum[i]) / seg, dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1;
  return { e: pts[i][0] + dx * u, n: pts[i][1] + dy * u, de: dx / l, dn: dy / l };
}

function carGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); parts.push(g);
  };
  box(4.2, 0.62, 1.78, 0, 0.64, 0, [1, 1, 1]);                 // body (tinted by the instance colour)
  box(2.2, 0.5, 1.56, -0.25, 1.2, 0, [0.14, 0.17, 0.22]);       // cabin glass
  box(1.9, 0.07, 1.5, -0.25, 1.48, 0, [1, 1, 1]);              // roof
  for (const x of [-1.3, 1.3]) for (const z of [-0.85, 0.85]) box(0.72, 0.62, 0.22, x, 0.31, z, [0.04, 0.04, 0.045]);   // wheels
  return mergeGeometries(parts)!;
}

interface Car { key: string; pts: [number, number][]; cum: number[]; s: number; dir: 1 | -1; speed: number; lane: number; cls: string }
const PALETTE: [number, number, number][] = [[0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.62, 0.64, 0.68], [0.62, 0.64, 0.68], [0.06, 0.06, 0.07], [0.06, 0.06, 0.07], [0.12, 0.2, 0.5], [0.55, 0.08, 0.08], [0.25, 0.27, 0.3], [0.1, 0.32, 0.2], [0.75, 0.55, 0.1]];

export class Traffic {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private lights: THREE.Points; private lightPos: Float32Array; private lightMat: THREE.PointsMaterial;
  private cars: Car[] = [];
  count = 260; radius = 380;
  private rnd: () => number;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1); private up = new THREE.Vector3(0, 1, 0);
  private col = new THREE.Color();

  constructor(private roads: RoadMarkings, private heightAt: (e: number, n: number) => number, seed = 12345, private max = 260) {
    let s = seed >>> 0; this.rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
    this.mesh = new THREE.InstancedMesh(carGeometry(), mat, max); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, this.col.setRGB(...PALETTE[Math.floor(this.rnd() * PALETTE.length)]));
    this.lightPos = new Float32Array(max * 2 * 3); const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3));
    const lc = new Float32Array(max * 2 * 3); for (let i = 0; i < max; i++) { lc.set([1, 0.93, 0.75], i * 6); lc.set([1, 0.08, 0.05], i * 6 + 3); }
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3)); lg.setDrawRange(0, 0);
    this.lightMat = new THREE.PointsMaterial({ size: 1.1, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.lights = new THREE.Points(lg, this.lightMat); this.lights.frustumCulled = false;
    this.group.add(this.mesh, this.lights); this.group.visible = false; this.group.name = 'traffic';
  }

  private spawn(c: Car | null, e: number, n: number): Car | null {
    let r = null; for (let t = 0; t < 12 && !r; t++) r = this.roads.randomRoad(e, n, this.radius, this.rnd);   // most random spots are fields: try several
    if (!r) return null;
    const cum = polyLengths(r.pts), L = cum[cum.length - 1]; if (L < 20) return null;
    const car = c ?? ({} as Car);
    car.key = r.key; car.pts = r.pts; car.cum = cum; car.cls = r.cls; car.s = this.rnd() * L;
    car.dir = r.cls === 'motorway' ? 1 : this.rnd() < 0.5 ? 1 : -1;
    car.speed = (SPEED[r.cls] ?? 8) * (0.85 + 0.3 * this.rnd());
    car.lane = r.cls === 'motorway' ? MOTORWAY_LANES[Math.floor(this.rnd() * 3)] : (LANE[r.cls] ?? 1.4) * car.dir;   // left-hand traffic: left of the direction of travel
    return car;
  }

  /** Call every frame (when not paused) with the time step, the camera position (three.js world), the aircraft's height above ground and the night factor. */
  update(dt: number, cam: THREE.Vector3, agl: number, night: number) {
    const e0 = cam.x, n0 = -cam.z;
    const show = agl < 400; this.group.visible = show; if (!show) return;
    // top up the fleet, a few cars per frame at most (finding a road costs a little)
    for (let a = 0; a < 4 && this.cars.length < this.count; a++) { const c = this.spawn(null, e0, n0); if (c) this.cars.push(c); }
    let k = 0; const R2 = (this.radius + 120) ** 2;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.s += c.dir * c.speed * dt;
      const L = c.cum[c.cum.length - 1];
      let pt = pointAt(c.pts, c.cum, c.s);
      const far = (pt.e - e0) ** 2 + (pt.n - n0) ** 2 > R2;
      if (c.s < 0 || c.s > L || far) { this.spawn(c, e0, n0); pt = pointAt(c.pts, c.cum, c.s); }
      // side offset: the left of the polyline's direction is (-dn, de)
      const e = pt.e - pt.dn * c.lane, n = pt.n + pt.de * c.lane, de = pt.de * c.dir, dn = pt.dn * c.dir;
      const hf = this.heightAt(e + de * 1.8, n + dn * 1.8), hb = this.heightAt(e - de * 1.8, n - dn * 1.8), h = (hf + hb) / 2;
      const yaw = Math.atan2(dn, de), pitch = Math.atan2(hf - hb, 3.6);
      this.q.setFromAxisAngle(this.up, yaw); const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch); this.q.multiply(qp);
      this.p.set(e, h + 0.04, -n); this.m.compose(this.p, this.q, this.one); this.mesh.setMatrixAt(k, this.m);
      // head and tail lights: 1.9 m ahead and behind the centre, 0.7 m up
      const hx = de * 2.05, hz = -dn * 2.05, o = k * 6;
      this.lightPos[o] = e + hx; this.lightPos[o + 1] = h + 0.72; this.lightPos[o + 2] = -n + hz;
      this.lightPos[o + 3] = e - hx; this.lightPos[o + 4] = h + 0.78; this.lightPos[o + 5] = -n - hz;
      k++;
    }
    this.mesh.count = k; this.mesh.instanceMatrix.needsUpdate = true;
    const lg = this.lights.geometry; lg.setDrawRange(0, k * 2); (lg.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.lightMat.opacity = Math.min(1, night * 1.4);
    this.lights.visible = night > 0.05;
  }
  /** Quality setting: how many cars. */
  setDensity(f: number) { this.count = Math.round(this.max * f); if (this.cars.length > this.count) this.cars.length = this.count; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.lights.geometry.dispose(); this.lightMat.dispose(); }
}
