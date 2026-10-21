// Collision / physics debug visualisation and live collision-geometry editor (F8).

import * as THREE from 'three';
import { Aircraft } from '../sim/fdm/aircraft';
import { World } from '../world/world';
import { Vec3 } from '../core/math';
import { nedToThree } from './coords';

export class DebugView {
  readonly group = new THREE.Group();
  enabled = false;
  private gearMarks: THREE.Mesh[] = [];
  private contactMarks: THREE.Mesh[] = [];
  private hullMarks: THREE.Mesh[] = [];
  private forceLines: THREE.LineSegments;
  private terrainTris: THREE.LineSegments;
  private bldLines: THREE.LineSegments;
  private panel: HTMLDivElement | null = null;
  private lastBldQuery = new THREE.Vector3(1e9, 0, 0);

  constructor(private ac: Aircraft, private world: World) {
    this.group.name = 'debug';
    this.group.visible = false;
    const sph = (r: number, c: number) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.85 }));
    for (let i = 0; i < ac.def.gear.length; i++) { const m = sph(0.12, 0x22ff66); m.renderOrder = 10; this.gearMarks.push(m); this.group.add(m); }
    for (let i = 0; i < ac.def.contacts.length; i++) { const m = sph(0.08, 0xff4444); m.renderOrder = 10; this.contactMarks.push(m); this.group.add(m); }
    for (let i = 0; i < ac.def.hullPoints.length; i++) { const m = sph(0.06, 0x44aaff); m.renderOrder = 10; this.hullMarks.push(m); this.group.add(m); }
    const lm = (c: number) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
    this.forceLines = new THREE.LineSegments(new THREE.BufferGeometry(), lm(0xffee00));
    this.terrainTris = new THREE.LineSegments(new THREE.BufferGeometry(), lm(0x00ffff));
    this.bldLines = new THREE.LineSegments(new THREE.BufferGeometry(), lm(0xff66ff));
    for (const l of [this.forceLines, this.terrainTris, this.bldLines]) { l.frustumCulled = false; l.renderOrder = 9; this.group.add(l); }
  }

  toggle() {
    this.enabled = !this.enabled;
    this.group.visible = this.enabled;
    if (this.enabled) this.showEditor(); else this.panel?.remove();
  }

  update() {
    if (!this.enabled) return;
    const ac = this.ac;
    const v = new THREE.Vector3();
    // gear: tyre contact point (green = in contact, white = airborne, red = bottomed)
    const forces: number[] = [];
    ac.def.gear.forEach((g, i) => {
      const s = ac.gearStates[i];
      const p = ac.worldPoint(g.attach.add(new Vec3(0, 0, g.length - s.compression)));
      nedToThree(p, v);
      this.gearMarks[i].position.copy(v);
      (this.gearMarks[i].material as THREE.MeshBasicMaterial).color.set(s.bottomed ? 0xff2222 : s.contact ? 0x22ff66 : 0xffffff);
      if (s.contact) {
        const top = v.clone().add(new THREE.Vector3(0, s.force / 2000, 0));
        forces.push(v.x, v.y, v.z, top.x, top.y, top.z);
      }
    });
    ac.def.contacts.forEach((c, i) => {
      nedToThree(ac.worldPoint(c.pos), v);
      this.contactMarks[i].position.copy(v);
      (this.contactMarks[i].material as THREE.MeshBasicMaterial).color.set(ac.contactActive[i] ? 0xffff00 : 0xff4444);
    });
    ac.def.hullPoints.forEach((h, i) => { nedToThree(ac.worldPoint(h), v); this.hullMarks[i].position.copy(v); });
    this.forceLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(forces, 3));

    // terrain triangles under each wheel (the exact physics triangles)
    const tri: number[] = [];
    const grid = this.world.terrain.hi;
    for (let i = 0; i < ac.def.gear.length; i++) {
      const p = ac.worldPoint(ac.def.gear[i].attach);
      const e = p.y, n = p.x;
      const fc = (e + grid.half) / grid.step, fr = (grid.half - n) / grid.step;
      const c0 = Math.floor(fc), r0 = Math.floor(fr);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r = r0 + dr, c = c0 + dc;
        const P = (rr: number, cc: number) => [-grid.half + cc * grid.step, grid.at(rr, cc) + 0.05, -(grid.half - rr * grid.step)];
        const nw = P(r, c), ne = P(r, c + 1), sw = P(r + 1, c), se = P(r + 1, c + 1);
        for (const [a, b] of [[nw, ne], [ne, se], [se, sw], [sw, nw], [ne, sw]]) tri.push(...a, ...b);
      }
    }
    this.terrainTris.geometry.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));

    // nearby building prisms (the collision volumes)
    const here = nedToThree(ac.pos);
    if (here.distanceTo(this.lastBldQuery) > 50) {
      this.lastBldQuery.copy(here);
      const e = ac.pos.y, n = ac.pos.x;
      const ids = this.world.obstacles.query(e - 400, n - 400, e + 400, n + 400);
      const L: number[] = [];
      for (const id of ids) {
        const b = this.world.obstacles.buildings[id];
        const m = b.pts.length / 2;
        for (let k = 0; k < m; k++) {
          const j = (k + 1) % m;
          const x0 = b.pts[2 * k], y0 = b.pts[2 * k + 1], x1 = b.pts[2 * j], y1 = b.pts[2 * j + 1];
          L.push(x0, b.base, -y0, x1, b.base, -y1, x0, b.top, -y0, x1, b.top, -y1, x0, b.base, -y0, x0, b.top, -y0);
        }
      }
      this.bldLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
    }
  }

  /** In-sim editor for the collision geometry (body-frame coordinates, metres). */
  private showEditor() {
    const ac = this.ac;
    const p = document.createElement('div');
    p.className = 'jv-panel jv-debug';
    const rows: string[] = [];
    const row = (kind: string, i: number, name: string, v: Vec3) =>
      `<tr><td>${name}</td>${['x', 'y', 'z'].map((k) => `<td><input data-k="${kind}" data-i="${i}" data-c="${k}" type="number" step="0.01" value="${(v as any)[k].toFixed(2)}"></td>`).join('')}</tr>`;
    ac.def.gear.forEach((g, i) => rows.push(row('gear', i, `Gear: ${g.name} (attach)`, g.attach)));
    ac.def.contacts.forEach((c, i) => rows.push(row('contact', i, `Contact: ${c.name}`, c.pos)));
    ac.def.hullPoints.forEach((h, i) => rows.push(row('hull', i, `Hull point ${i + 1}`, h)));
    p.innerHTML = `<h3>Collision geometry</h3>
      <p class="jv-dim">Body frame (x fwd, y right, z down), metres from the datum. Green: gear contact points (red when bottomed),
      red/yellow: crash points, blue: building-collision points, cyan: physics terrain triangles, magenta: building collision prisms,
      yellow lines: gear normal force (1 m = 2 kN). Edits apply immediately.</p>
      <div class="jv-scroll"><table>${rows.join('')}</table></div>
      <button id="jv-export">Copy as JSON</button>`;
    p.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const val = parseFloat(t.value);
      if (Number.isNaN(val)) return;
      const i = Number(t.dataset.i);
      const vec = t.dataset.k === 'gear' ? ac.def.gear[i].attach : t.dataset.k === 'contact' ? ac.def.contacts[i].pos : ac.def.hullPoints[i];
      (vec as any)[t.dataset.c!] = val;
    });
    p.querySelector('#jv-export')!.addEventListener('click', () => {
      const out = {
        gear: ac.def.gear.map((g) => ({ name: g.name, attach: g.attach })),
        contacts: ac.def.contacts.map((c) => ({ name: c.name, pos: c.pos })),
        hullPoints: ac.def.hullPoints,
      };
      navigator.clipboard?.writeText(JSON.stringify(out, null, 1));
    });
    document.body.appendChild(p);
    this.panel = p;
  }
}
