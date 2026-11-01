// Detailed 737-800 flight deck (third-party model, licensed by the project owner for
// commercial use) converted offline to a compact vertex-coloured mesh (tools: see PROJECT_STATE.md).
// Moving parts are separate groups driven by the simulation: control wheels, thrust levers,
// speedbrake, flap and gear levers, trim wheels. The glass panels are the canvas displays of
// B737Cockpit, mapped onto the model's screen positions.
// Model axes: x = aircraft left, y = up, z = forward, ~0.04 m per unit.

import * as THREE from 'three';
import type { FlightControls } from '../sim/controls';

interface Chunk { nv: number; ni: number; pos: number; nor: number; col: number; idx: number; bbox: number[] }
const S = 0.04;
/** model -> body frame (FRD); the captain's eye (17.5, 126.5, 62) lands on the aircraft eye point. */
const TO_BODY = new THREE.Matrix4().set(
  0, 0, S, 11.72,
  -S, 0, 0, 0.17,
  0, -S, 0, 4.52,
  0, 0, 0, 1,
);

function geometry(buf: ArrayBuffer, c: Chunk, pivot?: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, c.pos, c.nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, c.nor, c.nv * 4), 4, true));
  // restyle the model's raw colours into a dark charcoal flight deck (like a real 737: dark grey panels, light-grey trim, lighter switch caps)
  const src = new Uint8Array(buf, c.col, c.nv * 4), col = new Uint8Array(c.nv * 4);
  for (let i = 0; i < c.nv; i++) {
    const lum = (0.3 * src[i * 4] + 0.59 * src[i * 4 + 1] + 0.11 * src[i * 4 + 2]) / 255;
    const v = Math.round(255 * (0.10 + 0.55 * lum * lum));
    col[i * 4] = v; col[i * 4 + 1] = Math.round(v * 1.02); col[i * 4 + 2] = Math.round(v * 1.08); col[i * 4 + 3] = 255;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, c.idx, c.ni), 1));
  if (pivot) g.translate(-pivot.x, -pivot.y, -pivot.z);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400); // unused vertices may hold NaN
  return g;
}

type Lever = { group: THREE.Group; pivot: THREE.Vector3 };

export class Cockpit737Model {
  readonly root = new THREE.Group();
  private parts: Record<string, Lever> = {};
  private gearPos = 0;
  private sbPos = 0;
  private flapPos = 0;
  // Clean forward view: hide control wheels that obscure the primary instruments.
  // Their controls still work in the flight model.
  private cleanView = true;
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: 0x050607, side: THREE.DoubleSide, color: 0x6a6d70, envMapIntensity: 0.2 }); // dark flight deck: the raw model colours blow out under the outdoor sun

  static async load(url: string): Promise<Cockpit737Model> {
    const [meta, buf] = await Promise.all([fetch(`${url}.json`).then((r) => r.json()), fetch(`${url}.bin`).then((r) => r.arrayBuffer())]);
    return new Cockpit737Model(meta, buf);
  }

  private constructor(meta: { parts: Record<string, { opaque: Chunk | null }> }, buf: ArrayBuffer) {
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(TO_BODY);
    const stat = meta.parts.static.opaque!;
    const sg = geometry(buf, stat);
    {
      // Remove the window pillars and roof-corner structure that block the pilot's forward view: anything ahead of the
      // pilot's face, above the glareshield line and outboard of the display panel (model units: x left, y up, z forward).
      const P = sg.getAttribute('position'), I = sg.getIndex()!, keep: number[] = [];
      for (let t = 0; t < I.count; t += 3) {
        const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
        const x = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, y = (P.getY(a) + P.getY(b) + P.getY(c)) / 3, z = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3;
        const pillar = z > 66 && y > 124 && Math.abs(x) > 16;
        if (!pillar) keep.push(a, b, c);
      }
      sg.setIndex(keep);
    }
    const sm = new THREE.Mesh(sg, this.mat);
    sm.frustumCulled = false;
    this.root.add(sm);
    // pivot points (model units) for each moving part
    const bb = (n: string) => meta.parts[n].opaque!.bbox;
    const centre = (n: string) => { const b = bb(n); return new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2); };
    const pivots: Record<string, THREE.Vector3> = {
      yokeCap: centre('yokeCap'), yokeFO: centre('yokeFO'), trim: centre('trim'),
    };
    for (const n of ['throttleL', 'throttleR', 'speedbrake', 'flaplever']) { const b = bb(n); pivots[n] = new THREE.Vector3((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2); }
    pivots.gearlever = new THREE.Vector3(0, 0, 0);
    for (const n of Object.keys(pivots)) {
      const c = meta.parts[n].opaque!;
      const grp = new THREE.Group();
      const m = new THREE.Mesh(geometry(buf, c, pivots[n]), this.mat);
      m.frustumCulled = false;
      grp.add(m);
      grp.position.copy(pivots[n]);
      this.root.add(grp);
      this.parts[n] = { group: grp, pivot: pivots[n] };
      if (this.cleanView && (n === 'yokeCap' || n === 'yokeFO')) grp.visible = false;
    }
  }

  /** Screen quads: model-space rectangle (x range, y range at z) showing a UV crop of the canvas. */
  addScreen(tex: THREE.Texture, x0: number, x1: number, y0: number, y1: number, z: number, crop: [number, number, number, number], CW: number, CH: number, unlit = true) {
    const [cx, cy, cw, ch] = crop;
    const u0 = cx / CW, u1 = (cx + cw) / CW, v1 = 1 - cy / CH, v0 = 1 - (cy + ch) / CH;
    // seen from the pilot (looking +z), screen-right is -x: x1 (smaller x) is the right edge
    const p = [x0, y1, z, x0, y0, z, x1, y0, z, x1, y1, z];
    const uv = [u0, v1, u0, v0, u1, v0, u1, v1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
    void unlit;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    this.root.add(m);
    return m;
  }

  update(dt: number, c: FlightControls, eff: { pitch: number; roll: number }) {
    const k = 1 - Math.exp(-dt * 8);
    const P = this.parts;
    // control wheels: roll turns the wheel, pitch moves the column fore/aft (+pitch = pull = aft)
    for (const n of ['yokeCap', 'yokeFO']) {
      P[n].group.rotation.z = -eff.roll * 1.2;
      P[n].group.position.z = P[n].pivot.z - eff.pitch * 2.2;
    }
    const thr = -0.2 + c.throttle * 0.8;
    P.throttleL.group.rotation.x = thr; P.throttleR.group.rotation.x = thr;
    this.sbPos += (c.speedbrake - this.sbPos) * k;
    P.speedbrake.group.rotation.x = -0.75 * this.sbPos;
    this.flapPos += (c.flapLever - this.flapPos) * k;
    P.flaplever.group.rotation.x = -0.12 * this.flapPos;
    this.gearPos += ((c.gearDown ? 0 : 1) - this.gearPos) * k;
    P.gearlever.group.position.y = this.gearPos * 3;
    P.trim.group.rotation.x = c.trim * 8;
  }
}
