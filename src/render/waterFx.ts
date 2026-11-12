// PRO: spray and splashes. Flying low over water throws up a rooster-tail of spray behind the aircraft; touching down (or skimming at speed)
// makes bigger, taller splashes with falling droplets. Sprites with gravity, fading as they fall.
import * as THREE from 'three';
import type { Aircraft } from '../sim/fdm/aircraft';
import { enuToThree } from './coords';

interface P { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number; s0: number; s1: number; a0: number }
export class WaterFx {
  readonly group = new THREE.Group();
  private ps: P[] = [];
  private tex: THREE.Texture;
  private acc = 0;
  constructor() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d')!, gr = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.45, 'rgba(235,245,255,0.55)'); gr.addColorStop(1, 'rgba(225,240,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(cv); this.group.name = 'water-fx';
  }
  private emit(p: THREE.Vector3, v: THREE.Vector3, size: number, alpha: number, life: number) {
    if (this.ps.length > 900) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: new THREE.Color(1.05, 1.2, 1.35), transparent: true, depthWrite: false, opacity: alpha, fog: true }));   // darker blue-grey spray (was over-bright white)
    s.position.copy(p); s.scale.setScalar(size); s.renderOrder = 3; this.group.add(s);
    this.ps.push({ s, v, age: 0, life, s0: size, s1: size * 2.6, a0: alpha });
  }
  private rings: { m: THREE.Mesh; age: number; life: number; r1: number }[] = [];
  /** A water entry at speed v (m/s): a column of water, a crown of spray thrown outward, and rings spreading across the sea. */
  impact(pos: THREE.Vector3, v: number) {
    const s = THREE.MathUtils.clamp(v / 55, 0.1, 1.8);
    const n = Math.floor(70 + 520 * s);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rad = Math.random() * (2 + 6 * s);
      const out = (2 + 22 * s) * Math.sqrt(Math.random()), up = (5 + 34 * s) * Math.pow(Math.random(), 0.6);
      const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * rad * 0.4, 0.3, Math.sin(a) * rad * 0.4));
      this.emit(p, new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out), 2.5 + 9 * s * Math.random(), 0.75, 1.6 + 2.6 * Math.random() * (0.5 + s));
    }
    for (let k = 0; k < 3; k++) {
      const g = new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.2, 1.4), transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, fog: true }));
      m.position.copy(pos); m.position.y += 0.4 + 0.05 * k; m.renderOrder = 3; this.group.add(m);
      this.rings.push({ m, age: -0.5 * k, life: 5 + 3 * s, r1: 40 + 260 * s * (1 - 0.18 * k) });
    }
  }
  update(dt: number, ac: Aircraft, isWater: (e: number, n: number) => boolean, surfaceY: (e: number, n: number) => number) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.age += dt;
      if (r.age >= r.life) { this.group.remove(r.m); r.m.geometry.dispose(); (r.m.material as THREE.Material).dispose(); this.rings.splice(i, 1); continue; }
      if (r.age < 0) continue;
      const t = r.age / r.life, sc = 2 + (r.r1 - 2) * (1 - Math.pow(1 - t, 2.2));
      r.m.scale.set(sc, 1, sc); (r.m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t) * Math.min(1, r.age * 3);
    }
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i]; p.age += dt;
      if (p.age >= p.life) { this.group.remove(p.s); (p.s.material as THREE.SpriteMaterial).dispose(); this.ps.splice(i, 1); continue; }
      p.v.y -= 9.0 * dt; p.v.multiplyScalar(1 - 0.8 * dt); p.s.position.addScaledVector(p.v, dt);
      const t = p.age / p.life; p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * t);
      (p.s.material as THREE.SpriteMaterial).opacity = p.a0 * (1 - t) * (1 - t);
    }
    const v = Math.hypot(ac.vel.x, ac.vel.y);
    if (ac.crashed || v < 8 || !isWater(ac.pos.y, ac.pos.x)) return;
    const h = -ac.pos.z - surfaceY(ac.pos.y, ac.pos.x);       // height of the aircraft's lowest reference above the water
    const reach = Math.max(9, (ac.def.wingArea ? Math.sqrt(ac.def.wingArea) : 3) * 1.2);   // spray starts within about this height of the water
    if (h > reach + 2) return;
    const strength = THREE.MathUtils.clamp(1 - Math.max(0, h - 0.5) / (reach + 1.5), 0, 1) * Math.min(1, v / 40);
    this.acc += dt * (60 + 200 * strength) * strength;
    const fwd = new THREE.Vector3(ac.vel.y, 0, -ac.vel.x).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    while (this.acc >= 1) {
      this.acc -= 1;
      const base = enuToThree(ac.pos.y, ac.pos.x, surfaceY(ac.pos.y, ac.pos.x) + 0.2);
      const sp = (Math.random() - 0.5) * 2;
      const vel = fwd.clone().multiplyScalar(-v * 0.15).addScaledVector(side, sp * (2 + 5 * strength)).add(new THREE.Vector3(0, 2.5 + 6 * strength * Math.random(), 0));
      base.addScaledVector(side, sp * reach * 0.5).addScaledVector(fwd, -Math.random() * 6);
      this.emit(base, vel, 1.5 + 4.5 * strength, 0.6 + 0.35 * strength, 1.0 + 1.2 * Math.random());
    }
  }
}
