// Tyre smoke: a puff of white-grey smoke from each main wheel at touchdown (the tyre spins up from
// zero to ground speed in a fraction of a second), and a thin trail while the wheels skid under heavy braking.

import * as THREE from 'three';
import type { Aircraft } from '../sim/fdm/aircraft';
import { Vec3 } from '../core/math';
import { enuToThree } from './coords';

interface Puff { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number; s0: number; s1: number; a0: number }

export class TyreSmoke {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private prevContact: boolean[] = [];
  private tex: THREE.Texture;

  constructor() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d')!, gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(235,235,235,0.9)'); gr.addColorStop(0.5, 'rgba(215,215,215,0.45)'); gr.addColorStop(1, 'rgba(200,200,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(cv);
    this.group.name = 'tyre-smoke';
  }

  private emit(pos: THREE.Vector3, vel: THREE.Vector3, size: number, alpha: number, life: number) {
    if (this.puffs.length > 240) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: alpha, fog: true }));
    s.position.copy(pos); s.scale.setScalar(size); s.renderOrder = 3;
    this.group.add(s);
    this.puffs.push({ s, v: vel, age: 0, life, s0: size, s1: size * 4.5, a0: alpha });
  }

  update(dt: number, ac: Aircraft, groundAt: (e: number, n: number) => number) {
    const gs = Math.hypot(ac.vel.x, ac.vel.y);
    const first = ac.def.gear.length > 2 ? 1 : 0; // skip the nose wheel
    ac.def.gear.forEach((g, i) => {
      const st = ac.gearStates[i];
      const was = this.prevContact[i] ?? st.contact;
      this.prevContact[i] = st.contact;
      if (i < first || ac.def.glider || ac.crashed) return;
      const p = ac.worldPoint(new Vec3(g.attach.x, g.attach.y, g.attach.z));
      const e = p.y, n = p.x, h = groundAt(e, n) + 0.15;
      const base = enuToThree(e, n, h);
      const dir = new THREE.Vector3(ac.vel.y, 0, -ac.vel.x).multiplyScalar(0.25); // drifts along the runway, slowing
      if (st.contact && !was && gs > 18) {
        const n0 = Math.round(THREE.MathUtils.clamp(gs / 5 + Math.abs(st.touchdownSink) * 3, 5, 18));
        for (let k = 0; k < n0; k++) {
          const v = dir.clone().multiplyScalar(0.6 + Math.random() * 0.6); v.x += (Math.random() - 0.5) * 2; v.z += (Math.random() - 0.5) * 2; v.y = 0.4 + Math.random() * 1.2;
          const b = base.clone(); b.x -= ac.vel.y * 0.004 * k; b.z += ac.vel.x * 0.004 * k;
          this.emit(b, v, 0.9 + Math.random() * 0.8, 0.55 + Math.random() * 0.25, 2.6 + Math.random() * 1.6);
        }
      } else if (st.contact && st.skidding && gs > 12 && Math.random() < dt * 14) {
        this.emit(base, dir.clone().multiplyScalar(0.5).setY(0.5), 0.8, 0.28, 1.8);
      }
    });
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { this.group.remove(p.s); (p.s.material as THREE.Material).dispose(); this.puffs.splice(i, 1); continue; }
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(Math.exp(-dt * 0.8));
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(t));
      (p.s.material as THREE.SpriteMaterial).opacity = p.a0 * (1 - t) * (1 - t);
    }
  }
}
