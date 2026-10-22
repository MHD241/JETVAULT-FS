// Crash effects: the airframe breaks into tumbling debris, with an explosion, fire and smoke.
// Purely visual: it runs after the simulation has declared the aircraft crashed.

import * as THREE from 'three';

function blobTexture(stops: [number, string][]) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Particle { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number; size0: number; size1: number; kind: 'fire' | 'smoke' | 'boom'; }
interface Debris { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; rest: boolean; burn: number; }

export class CrashFx {
  readonly group = new THREE.Group();
  private parts: Particle[] = [];
  private debris: Debris[] = [];
  private fireTex = blobTexture([[0, 'rgba(255,240,170,1)'], [0.35, 'rgba(255,140,30,0.9)'], [1, 'rgba(200,40,0,0)']]);
  private smokeTex = blobTexture([[0, 'rgba(40,40,40,0.8)'], [0.6, 'rgba(60,60,60,0.35)'], [1, 'rgba(70,70,70,0)']]);
  private origin = new THREE.Vector3();
  private ground = 0;
  private age = 0;
  active = false;

  constructor(scene: THREE.Scene) { scene.add(this.group); }

  clear() {
    for (const p of this.parts) this.group.remove(p.s);
    for (const d of this.debris) { this.group.remove(d.m); d.m.geometry.dispose(); }
    this.parts = []; this.debris = []; this.active = false; this.age = 0;
  }

  /** pos/vel in three.js world coordinates; groundY is the terrain height under the aircraft. */
  trigger(pos: THREE.Vector3, vel: THREE.Vector3, groundY: number, span: number, color: number) {
    this.clear();
    this.active = true;
    this.origin.copy(pos);
    this.ground = groundY;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const mats = [color, 0xe9edf3, 0x2a2f38, 0xb02020].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.2 }));
    const kinds: [number, number, number][] = [
      [span * 0.28, 0.06, 0.9], [span * 0.28, 0.06, 0.9], [span * 0.12, 0.5, 0.5], [span * 0.35, 0.5, 0.5], [span * 0.1, 0.4, 0.8],
      [span * 0.14, 0.1, 0.45], [span * 0.14, 0.1, 0.45], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.8, 0.1, 0.4],
    ];
    for (let i = 0; i < 22; i++) {
      const k = kinds[i % kinds.length];
      const sz = rnd(0.5, 1.2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(k[0] * sz, k[1] * span * 0.3 * sz + 0.08, k[2] * span * 0.2 * sz + 0.1), mats[i % mats.length]);
      m.position.copy(pos).add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(0, 1.2), rnd(-1.5, 1.5)));
      m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      this.group.add(m);
      this.debris.push({
        m, rest: false, burn: 0,
        v: vel.clone().multiplyScalar(rnd(0.25, 0.7)).add(new THREE.Vector3(rnd(-9, 9), rnd(4, 16), rnd(-9, 9))),
        spin: new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)),
      });
    }
    // explosion fireball + flash
    for (let i = 0; i < 26; i++) this.emit('boom', pos, new THREE.Vector3(rnd(-12, 12), rnd(1, 14), rnd(-12, 12)).add(vel.clone().multiplyScalar(0.2)), rnd(0.6, 1.4), 4, rnd(10, 18));
    for (let i = 0; i < 18; i++) this.emit('smoke', pos, new THREE.Vector3(rnd(-6, 6), rnd(4, 12), rnd(-6, 6)), rnd(5, 9), 4, rnd(18, 34));
  }

  private emit(kind: Particle['kind'], at: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number) {
    const mat = new THREE.SpriteMaterial({ map: kind === 'smoke' ? this.smokeTex : this.fireTex, transparent: true, depthWrite: false, blending: kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(at); s.scale.setScalar(s0); s.renderOrder = 5;
    this.group.add(s);
    this.parts.push({ s, v, age: 0, life, size0: s0, size1: s1, kind });
  }

  update(dt: number) {
    if (!this.active) return;
    this.age += dt;
    const g = 9.81;
    for (const d of this.debris) {
      if (d.rest) {
        d.burn += dt;
        if (Math.random() < dt * 3 && this.parts.length < 260) this.emit(Math.random() < 0.6 ? 'fire' : 'smoke', d.m.position, new THREE.Vector3(0, rndf(2, 5), 0), rndf(0.8, 1.6), 1.5, 3.5);
        continue;
      }
      d.v.y -= g * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      if (this.age < 3 && Math.random() < dt * 8) this.emit('smoke', d.m.position, new THREE.Vector3(0, 1.5, 0), 2.5, 1.5, 6);
      if (d.m.position.y <= this.ground + 0.2) {
        d.m.position.y = this.ground + 0.2;
        d.v.y *= -0.25; d.v.x *= 0.5; d.v.z *= 0.5; d.spin.multiplyScalar(0.5);
        if (d.v.length() < 2) d.rest = true;
      }
    }
    // main wreck fire and smoke column
    if (this.parts.length < 260) {
      if (Math.random() < dt * 40) this.emit('fire', this.origin.clone().add(new THREE.Vector3(rndf(-3, 3), 0.5, rndf(-3, 3))), new THREE.Vector3(rndf(-1, 1), rndf(3, 7), rndf(-1, 1)), rndf(0.7, 1.4), 3, 8);
      if (Math.random() < dt * 25) this.emit('smoke', this.origin.clone().add(new THREE.Vector3(0, 3, 0)), new THREE.Vector3(rndf(-1.5, 3), rndf(5, 9), rndf(-1.5, 1.5)), rndf(6, 10), 5, 26);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { this.group.remove(p.s); (p.s.material as THREE.SpriteMaterial).dispose(); this.parts.splice(i, 1); continue; }
      p.s.position.addScaledVector(p.v, dt);
      if (p.kind !== 'boom') p.v.x += 1.2 * dt; // wind drift
      p.v.multiplyScalar(Math.max(0, 1 - (p.kind === 'boom' ? 2.2 : 0.4) * dt));
      p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * t);
      (p.s.material as THREE.SpriteMaterial).opacity = p.kind === 'smoke' ? 1 - t : 0.45 * (1 - t * t);
    }
  }
}
const rndf = (a: number, b: number) => a + Math.random() * (b - a);
