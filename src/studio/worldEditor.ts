// World Studio (PRO): press F9 in the game to fly a free camera over the world and build on it. Pick a part, click the ground to place it,
// click a placed part to select it (move with Alt+click, rotate with [ ], scale with - =, delete with Del). Saved in this browser
// (localStorage) and drawn in the game for everyone using the same browser; Export/Import gives you the JSON file.
import * as THREE from 'three';
import type { World } from '../world/world';

type Kind = 'tree' | 'conifer' | 'house' | 'block' | 'tower' | 'hangar' | 'hedge';
interface Item { t: Kind; e: number; n: number; r: number; s: number }
const KEY = 'jetvault.worldstudio.v1';
const KINDS: [Kind, string][] = [['tree', 'Tree'], ['conifer', 'Conifer'], ['hedge', 'Hedge row'], ['house', 'House'], ['block', 'Office block'], ['tower', 'Tower'], ['hangar', 'Hangar']];

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c });
const M = { trunk: lam(0x4a3426), leaf: lam(0x2f5a1c), leaf2: lam(0x3d6e22), pine: lam(0x1d4026), wall: lam(0xd9cdb8), roof: lam(0x8a3b2a), glass: lam(0x93a9bd), conc: lam(0xb9bcc0), steel: lam(0x9aa3ab), hedge: lam(0x274d18) };
function build(t: Kind): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  if (t === 'tree') { add(new THREE.CylinderGeometry(0.3, 0.45, 3.5, 6), M.trunk, 0, 1.75, 0); add(new THREE.IcosahedronGeometry(3.4, 1).scale(1, 0.9, 1), M.leaf, 0, 6.2, 0); add(new THREE.IcosahedronGeometry(2.2, 1), M.leaf2, 1.5, 7.6, 0.6); }
  else if (t === 'conifer') { add(new THREE.CylinderGeometry(0.25, 0.4, 3, 6), M.trunk, 0, 1.5, 0); [[2.6, 6, 5], [2.0, 5, 8.4], [1.3, 4, 11.4]].forEach(([r, h, y]) => add(new THREE.ConeGeometry(r, h, 7), M.pine, 0, y, 0)); }
  else if (t === 'hedge') { add(new THREE.BoxGeometry(30, 1.8, 1.6), M.hedge, 0, 0.9, 0); }
  else if (t === 'house') { add(new THREE.BoxGeometry(9, 5, 7), M.wall, 0, 2.5, 0); add(new THREE.ConeGeometry(6.6, 3.2, 4).rotateY(Math.PI / 4).scale(1, 1, 0.8), M.roof, 0, 6.6, 0); }
  else if (t === 'block') { add(new THREE.BoxGeometry(22, 34, 18), M.glass, 0, 17, 0); add(new THREE.BoxGeometry(22.6, 1.2, 18.6), M.conc, 0, 34.6, 0); }
  else if (t === 'tower') { add(new THREE.CylinderGeometry(2.2, 3.4, 40, 12), M.conc, 0, 20, 0); add(new THREE.CylinderGeometry(7, 5, 6, 16), M.glass, 0, 43, 0); add(new THREE.ConeGeometry(5.2, 2.2, 16), M.steel, 0, 47.1, 0); }
  else if (t === 'hangar') { const h = add(new THREE.CylinderGeometry(15, 15, 60, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), M.steel, 0, 0, 0); h.scale.set(1, 0.55, 1); add(new THREE.BoxGeometry(60, 0.5, 30), M.conc, 0, 0.25, 0); }
  return g;
}

export class WorldEditor {
  active = false;
  private group = new THREE.Group();
  private items: Item[] = [];
  private objs: THREE.Object3D[] = [];
  private sel = -1;
  private armed: Kind | null = 'tree';
  private box: THREE.BoxHelper | null = null;
  private panel: HTMLDivElement;
  private info!: HTMLDivElement;
  private yaw = 0; private pitch = -0.4; private speed = 80;
  private keys = new Set<string>();
  private look = false;
  private ray = new THREE.Raycaster();
  private undo: string[] = [];
  onChange: (on: boolean) => void = () => {};

  constructor(private scene: THREE.Scene, private cam: THREE.PerspectiveCamera, private dom: HTMLElement, private world: World) {
    this.group.name = 'worldstudio'; scene.add(this.group);
    try { this.items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { this.items = []; }
    this.rebuild();
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:fixed;top:10px;right:10px;width:230px;background:#1b1f26ee;color:#d6dbe1;font:13px system-ui,sans-serif;border:1px solid #2a3039;border-radius:10px;padding:10px;z-index:50;display:none;max-height:92vh;overflow:auto';
    this.panel.innerHTML = `<b>World Studio</b> <span style="color:#8b94a0">(F9 to exit)</span><div id="ws-kinds" style="margin:8px 0;display:grid;grid-template-columns:1fr 1fr;gap:5px"></div>
      <div id="ws-info" style="color:#8b94a0;font-size:12px;margin-bottom:8px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <button data-a="rl">⟲ Rotate</button><button data-a="rr">⟳ Rotate</button><button data-a="sm">Smaller</button><button data-a="sb">Bigger</button>
        <button data-a="del">Delete</button><button data-a="undo">Undo</button><button data-a="exp">Export</button><button data-a="imp">Import</button>
        <button data-a="clr" style="grid-column:1/3">Clear everything</button></div>
      <div style="color:#8b94a0;font-size:12px;margin-top:8px;line-height:1.5">Fly: <b>WASD</b>, <b>Q/E</b> down/up, <b>Shift</b> fast, wheel = speed, hold <b>right mouse</b> to look.<br>Click ground = place. Click a part = select. <b>Alt+click</b> = move selected. Esc = stop placing.</div>`;
    document.body.appendChild(this.panel);
    this.info = this.panel.querySelector('#ws-info') as HTMLDivElement;
    const kinds = this.panel.querySelector('#ws-kinds') as HTMLDivElement;
    for (const [k, label] of KINDS) { const b = document.createElement('button'); b.textContent = label; b.dataset.k = k; kinds.appendChild(b); }
    this.panel.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button'); if (!b) return;
      if (b.dataset.k) { this.armed = b.dataset.k as Kind; this.sel = -1; this.refresh(); return; }
      const a = b.dataset.a;
      if (a === 'rl') this.edit((i) => { i.r -= 0.2618; }); else if (a === 'rr') this.edit((i) => { i.r += 0.2618; });
      else if (a === 'sm') this.edit((i) => { i.s = Math.max(0.2, i.s / 1.15); }); else if (a === 'sb') this.edit((i) => { i.s = Math.min(8, i.s * 1.15); });
      else if (a === 'del') this.del(); else if (a === 'undo') this.doUndo();
      else if (a === 'clr') { if (confirm('Remove everything you placed?')) { this.snap(); this.items = []; this.sel = -1; this.commit(); } }
      else if (a === 'exp') this.exportJson(); else if (a === 'imp') this.importJson();
    });
    window.addEventListener('keydown', (e) => this.onKey(e, true), true);
    window.addEventListener('keyup', (e) => this.onKey(e, false), true);
    window.addEventListener('wheel', (e) => { if (this.active && !this.panel.contains(e.target as Node)) { this.speed = Math.min(6000, Math.max(5, this.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); this.refresh(); } }, { passive: true });
    dom.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    dom.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.look = false; });
    window.addEventListener('mousemove', (e) => { if (this.active && this.look) { this.yaw -= e.movementX * 0.003; this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.003)); } });
    this.refresh();
  }

  toggle(on = !this.active) {
    if (on === this.active) return;
    this.active = on; this.panel.style.display = on ? 'block' : 'none';
    if (on) { const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ'); this.yaw = e.y; this.pitch = Math.min(-0.3, e.x); this.cam.position.y += 40; }
    this.look = false; this.keys.clear(); this.onChange(on);
  }

  private refresh() {
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('#ws-kinds button')) { const on = b.dataset.k === this.armed; b.style.background = on ? '#4f8ef7' : '#262c35'; b.style.color = '#fff'; b.style.border = '1px solid #2a3039'; b.style.borderRadius = '6px'; b.style.padding = '5px'; b.style.cursor = 'pointer'; }
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('button[data-a]')) { b.style.background = '#262c35'; b.style.color = '#d6dbe1'; b.style.border = '1px solid #2a3039'; b.style.borderRadius = '6px'; b.style.padding = '5px'; b.style.cursor = 'pointer'; }
    const s = this.sel >= 0 ? this.items[this.sel] : null;
    this.info.textContent = `${this.items.length} placed · speed ${Math.round(this.speed)} m/s · ` + (s ? `selected: ${s.t}, size ${s.s.toFixed(2)}` : this.armed ? `placing: ${this.armed}` : 'nothing armed');
  }

  private snap() { this.undo.push(JSON.stringify(this.items)); if (this.undo.length > 50) this.undo.shift(); }
  private doUndo() { const p = this.undo.pop(); if (p) { this.items = JSON.parse(p); this.sel = -1; this.commit(false); } }
  private commit(save = true) { if (save) { try { localStorage.setItem(KEY, JSON.stringify(this.items)); } catch { /* storage full or blocked */ } } this.rebuild(); this.refresh(); }
  private edit(fn: (i: Item) => void) { const i = this.items[this.sel]; if (!i) return; this.snap(); fn(i); this.commit(); }
  private del() { if (this.sel < 0) return; this.snap(); this.items.splice(this.sel, 1); this.sel = -1; this.commit(); }

  private rebuild() {
    for (const o of this.objs) this.group.remove(o);
    this.objs = [];
    if (this.box) { this.scene.remove(this.box); this.box = null; }
    this.items.forEach((it, idx) => {
      const o = build(it.t); o.userData.idx = idx;
      o.position.set(it.e, this.world.terrain.heightAt(it.e, it.n), -it.n); o.rotation.y = it.r; o.scale.setScalar(it.s);
      this.group.add(o); this.objs.push(o);
    });
    if (this.sel >= 0 && this.objs[this.sel]) { this.box = new THREE.BoxHelper(this.objs[this.sel], 0xffd400); this.scene.add(this.box); }
  }

  private groundHit(ev: MouseEvent): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction, h = (p: THREE.Vector3) => p.y - this.world.terrain.heightAt(p.x, -p.z);
    const p = new THREE.Vector3(); let t0 = 0, step = 4;
    for (let t = 0; t < 30000; t += step) { p.copy(o).addScaledVector(d, t); if (h(p) <= 0) { let a = t0, b = t; for (let k = 0; k < 24; k++) { const m = (a + b) / 2; p.copy(o).addScaledVector(d, m); if (h(p) > 0) a = m; else b = m; } return p.copy(o).addScaledVector(d, b); } t0 = t; step = Math.min(60, step * 1.04); }
    return null;
  }

  private onDown(ev: MouseEvent) {
    if (!this.active || this.panel.contains(ev.target as Node)) return;
    if (ev.button === 2) { this.look = true; return; }
    if (ev.button !== 0) return;
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.cam);
    const hit = this.ray.intersectObjects(this.objs, true)[0];
    let idx = -1;
    if (hit) { let o: THREE.Object3D | null = hit.object; while (o && o.userData.idx === undefined) o = o.parent; if (o) idx = o.userData.idx; }
    if (ev.altKey && this.sel >= 0) { const g = this.groundHit(ev); if (g) this.edit((i) => { i.e = g.x; i.n = -g.z; }); return; }
    if (idx >= 0) { this.sel = idx; this.armed = null; this.commit(false); this.refresh(); return; }
    const g = this.groundHit(ev);
    if (g && this.armed) { this.snap(); this.items.push({ t: this.armed, e: g.x, n: -g.z, r: Math.random() * 6.283, s: 0.85 + 0.3 * Math.random() }); this.sel = -1; this.commit(); }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.key === 'F9') { if (down && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); this.toggle(); } return; }
    if (!this.active) return;
    e.stopImmediatePropagation();
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (k === 'delete' || k === 'backspace') this.del();
    else if (k === '[') this.edit((i) => { i.r -= 0.2618; }); else if (k === ']') this.edit((i) => { i.r += 0.2618; });
    else if (k === '-') this.edit((i) => { i.s = Math.max(0.2, i.s / 1.15); }); else if (k === '=' || k === '+') this.edit((i) => { i.s = Math.min(8, i.s * 1.15); });
    else if (k === 'escape') { this.armed = null; this.sel = -1; this.commit(false); this.refresh(); }
    else if (k === 'z' && (e.ctrlKey || e.metaKey)) this.doUndo();
  }

  /** Free-fly camera; call every frame while active. */
  update(dt: number) {
    const fast = this.keys.has('shift') ? 4 : 1, v = this.speed * fast * dt;
    const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.cam.position;
    if (this.keys.has('w')) p.addScaledVector(f, v); if (this.keys.has('s')) p.addScaledVector(f, -v);
    if (this.keys.has('d')) p.addScaledVector(r, v); if (this.keys.has('a')) p.addScaledVector(r, -v);
    if (this.keys.has('e')) p.y += v; if (this.keys.has('q')) p.y -= v;
    const gh = this.world.terrain.heightAt(p.x, -p.z); if (p.y < gh + 2) p.y = gh + 2;
    this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.cam.updateMatrixWorld(true);
    if (this.box) this.box.update();
  }

  private exportJson() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(this.items, null, 1)], { type: 'application/json' })); a.download = 'jetvault-world.json'; a.click(); }
  private importJson() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (Array.isArray(d)) { this.snap(); this.items = d.filter((i) => i && typeof i.e === 'number' && typeof i.n === 'number' && KINDS.some(([k]) => k === i.t)).map((i) => ({ t: i.t, e: i.e, n: i.n, r: +i.r || 0, s: +i.s || 1 })); this.sel = -1; this.commit(); } } catch { alert('That file is not a JetVault world file.'); } };
    inp.click();
  }
}
