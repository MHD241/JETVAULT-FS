// The full Boeing 737-800 flight-deck model (glTF, 1.75 M triangles, no triangles removed), by hakai315 (CC BY 4.0).
// To keep the draw-call count low the ~2,300 meshes are merged per material (every triangle is kept); the
// control wheels, thrust levers, speedbrake, flap and gear levers and trim wheels stay separate so they can move.
// Model units are the original FBX units: x = left, y = up, z = forward, 0.01685 m per unit.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FlightControls } from '../sim/controls';

const S = 0.01685;
/** units -> body frame (FRD): the captain's eye (17.5, 126.5, 62 units) lands on body (14.0, -0.53, -0.78). */
const TO_BODY = new THREE.Matrix4().set(0, 0, S, 12.955, -S, 0, 0, -0.235, 0, -S, 0, 1.3515, 0, 0, 0, 1);

interface Lever { group: THREE.Group; pivot: THREE.Vector3 }
const PART_NAMES = ['yokeCap', 'yokeFO', 'colCap', 'colFO', 'throttleL', 'throttleR', 'speedbrake', 'flaplever', 'gearlever', 'trim'] as const;

export class CockpitFull {
  readonly root = new THREE.Group();
  readonly unit = new THREE.Group();
  private parts: Record<string, Lever> = {};
  private gearPos = 0; private sbPos = 0; private flapPos = 0;
  triangles = 0;

  static async load(url: string, partBoxes: Record<string, number[]>): Promise<CockpitFull> {
    const r = await fetch(url);
    if (!r.ok) throw new Error('cockpit model not found: ' + url);
    const buf = await r.arrayBuffer();
    const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    return new CockpitFull(gltf.scene, partBoxes);
  }

  private constructor(scene: THREE.Group, boxes: Record<string, number[]>) {
    this.root.add(this.unit);
    this.unit.matrixAutoUpdate = false; this.unit.matrix.copy(TO_BODY);
    scene.updateMatrixWorld(true);
    // control columns (the stick under each wheel) are not in the converter's list: boxes found by inspecting the model
    boxes = { ...boxes, colCap: [15.4, 91.5, 74.2, 20.5, 119, 81], colFO: [-17.5, 91.5, 74.2, -12.6, 119, 81] };
    const partMats: Record<string, THREE.Material[]> = {}; for (const n of PART_NAMES) partMats[n] = [];
    const inv = 1 / S, byMat = new Map<THREE.Material, THREE.BufferGeometry[]>(), partGeos: Record<string, THREE.BufferGeometry[]> = {};
    for (const n of PART_NAMES) partGeos[n] = [];
    const box = new THREE.Box3(), c = new THREE.Vector3();
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.index) { const n = g.getAttribute('position').count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
      g.applyMatrix4(m.matrixWorld); g.scale(inv, inv, inv);
      box.setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute).getCenter(c);
      let owner: string | null = null;
      if (box.getSize(new THREE.Vector3()).length() < 30) for (const n of PART_NAMES) { const b = boxes[n]; if (c.x >= b[0] - 0.6 && c.x <= b[3] + 0.6 && c.y >= b[1] - 0.6 && c.y <= b[4] + 0.6 && c.z >= b[2] - 0.6 && c.z <= b[5] + 0.6) { owner = n; break; } }
      this.triangles += g.index!.count / 3;
      if (owner) { partGeos[owner].push(g); partMats[owner].push(Array.isArray(m.material) ? m.material[0] : m.material); }
      else { const mat = Array.isArray(m.material) ? m.material[0] : m.material; let l = byMat.get(mat); if (!l) { l = []; byMat.set(mat, l); } l.push(g); }
      m.geometry.dispose();
    }
    // the model's own colours, roughness and metalness, unchanged
    const mk = (src: THREE.Material) => {
      const s = src as THREE.MeshStandardMaterial;
      return new THREE.MeshStandardMaterial({ color: s.color ? s.color.clone() : new THREE.Color(0.5, 0.5, 0.5), roughness: s.roughness ?? 0.8, metalness: s.metalness ?? 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    };
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mk(mat)); mesh.frustumCulled = false; this.unit.add(mesh);
    }
    for (const n of PART_NAMES) {
      const list = partGeos[n]; if (!list.length) continue;
      const b = boxes[n];
      const pivot = n.startsWith('yoke') || n === 'trim' ? new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2)
        : n === 'gearlever' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
      const merged = mergeGeometries(list, true); for (const g of list) g.dispose(); if (!merged) continue;
      merged.translate(-pivot.x, -pivot.y, -pivot.z);
      const grp = new THREE.Group(); grp.position.copy(pivot);
      const mesh = new THREE.Mesh(merged, partMats[n].map(mk)); mesh.frustumCulled = false; grp.add(mesh); this.unit.add(grp);
      this.parts[n] = { group: grp, pivot };
    }
    // the control wheel rides on the column: the whole yoke (column + wheel) pitches about the column's foot, the wheel turns for roll
    for (const [wheel, col] of [['yokeCap', 'colCap'], ['yokeFO', 'colFO']] as const) {
      const w = this.parts[wheel], c = this.parts[col];
      if (w && c) { c.group.add(w.group); w.group.position.sub(c.pivot); }
    }
    scene.clear();
  }

  addScreen(tex: THREE.Texture, x0: number, x1: number, y0: number, y1: number, z: number, crop: number[], cw: number, ch: number) {
    const [cx, cy, w, h] = crop, u0 = cx / cw, u1 = (cx + w) / cw, v1 = 1 - cy / ch, v0 = 1 - (cy + h) / ch;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y1, z, x0, y0, z, x1, y0, z, x1, y1, z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u0, v0, u1, v0, u1, v1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
    m.frustumCulled = false; this.unit.add(m);
  }

  update(dt: number, c: FlightControls, eff: { pitch: number; roll: number }) {
    const k = 1 - Math.exp(-dt * 8), P = this.parts;
    for (const n of ['yokeCap', 'yokeFO']) if (P[n]) P[n].group.rotation.z = -eff.roll * 1.2;
    for (const n of ['colCap', 'colFO']) if (P[n]) P[n].group.rotation.x = -eff.pitch * 0.22;
    const thr = -0.2 + c.throttle * 0.8;
    if (P.throttleL) P.throttleL.group.rotation.x = thr; if (P.throttleR) P.throttleR.group.rotation.x = thr;
    this.sbPos += (c.speedbrake - this.sbPos) * k; if (P.speedbrake) P.speedbrake.group.rotation.x = -0.75 * this.sbPos;
    this.flapPos += (c.flapLever - this.flapPos) * k; if (P.flaplever) P.flaplever.group.rotation.x = -0.12 * this.flapPos;
    this.gearPos += ((c.gearDown ? 0 : 1) - this.gearPos) * k; if (P.gearlever) P.gearlever.group.position.y = this.gearPos * 3;
    if (P.trim) P.trim.group.rotation.x = c.trim * 8;
  }
}
