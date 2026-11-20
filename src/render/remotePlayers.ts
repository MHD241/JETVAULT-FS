// Draws the other players' aircraft (multiplayer): a model per player, smoothed between network updates, and a name tag that follows it on screen.
// The airliner packs are used for all of them (a 737, a Cessna or anything without a pack is drawn as an A320 for now); the tag shows the real aircraft id.
import * as THREE from 'three';
import { Quat } from '../core/math';
import { AirlinerModel } from './airlinerModel';
import { bodyMatrix } from './coords';
import type { RemotePose } from '../net/multiplayer';

const PACKS = new Set(['a320', 'a340', 'a350', 'c17']);

interface Entry { id: string; ac: string; group: THREE.Group; model: AirlinerModel; tag: HTMLDivElement; pos: THREE.Vector3; q: THREE.Quaternion; fresh: boolean }

export class RemotePlayers {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private tags = document.createElement('div');
  private tmp = new THREE.Vector3();
  private m = new THREE.Matrix4();
  constructor() {
    this.group.name = 'remote players';
    this.tags.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;overflow:hidden';
    document.body.appendChild(this.tags);
  }

  update(poses: RemotePose[], camera: THREE.Camera, dt: number) {
    const seen = new Set<string>();
    const w = window.innerWidth, h = window.innerHeight, k = 1 - Math.exp(-Math.min(dt, 0.1) * 14);
    for (const p of poses) {
      seen.add(p.id);
      let e = this.entries.get(p.id);
      const ac = PACKS.has(p.ac) ? p.ac : 'a320';
      if (!e || e.ac !== ac) {
        if (e) this.drop(p.id);
        const group = new THREE.Group(); group.matrixAutoUpdate = false;
        const model = new AirlinerModel(ac); model.load().catch((err) => console.warn('remote model not loaded', err));
        group.add(model.root); this.group.add(group);
        const tag = document.createElement('div');
        tag.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-130%);padding:2px 8px;border-radius:6px;background:rgba(6,12,22,.72);color:#e8f1f7;font:600 12px system-ui,sans-serif;white-space:nowrap;display:none';
        this.tags.appendChild(tag);
        e = { id: p.id, ac, group, model, tag, pos: new THREE.Vector3(), q: new THREE.Quaternion(), fresh: true };
        this.entries.set(p.id, e);
      }
      // network pose (NED, FRD) -> three.js: position and a basis from the attitude
      const target = new THREE.Vector3(p.p[1], -p.p[2], -p.p[0]);
      bodyMatrix(new Quat(p.q[0], p.q[1], p.q[2], p.q[3]), this.m);
      const tq = new THREE.Quaternion().setFromRotationMatrix(this.m);
      if (e.fresh) { e.pos.copy(target); e.q.copy(tq); e.fresh = false; } else { e.pos.lerp(target, k); e.q.slerp(tq, k); }
      e.group.matrix.compose(e.pos, e.q, this.tmp.set(1, 1, 1));
      e.group.matrixWorldNeedsUpdate = true;
      // name tag
      const d = camera.position.distanceTo(e.pos);
      this.tmp.copy(e.pos); this.tmp.y += 6; this.tmp.project(camera);
      const on = this.tmp.z < 1 && d < 25000 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2;
      e.tag.style.display = on ? 'block' : 'none';
      if (on) {
        e.tag.style.left = `${(this.tmp.x * 0.5 + 0.5) * w}px`; e.tag.style.top = `${(-this.tmp.y * 0.5 + 0.5) * h}px`;
        e.tag.textContent = `${p.name} · ${p.ac.toUpperCase()} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}`;
      }
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.drop(id);
  }

  private drop(id: string) {
    const e = this.entries.get(id); if (!e) return;
    this.group.remove(e.group); e.tag.remove();
    e.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.entries.delete(id);
  }
  clear() { for (const id of [...this.entries.keys()]) this.drop(id); }
}
