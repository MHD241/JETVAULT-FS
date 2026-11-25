// Passenger cabin interior, built from simple shapes in the aircraft's body frame (x forward, y right, z DOWN, metres, origin at the datum): floor and carpet,
// side walls with a row of windows, sloped ceiling with light strips, overhead bins, seats in the real layout of each aircraft (instanced), bulkheads, and a
// seat-back entertainment screen on every seat that has a seat in front of it. The screens show placeholder adverts (made-up products) and are easy to replace.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PeopleField, Person, rng } from './people';

export interface CabinSpec { id: string; x0: number; x1: number; radius: number; groups: number[]; pitch: number }
export interface Seat { row: number; col: number; letter: string; x: number; y: number; window: boolean; aisle: boolean }

/** Seats abreast by aircraft (groups are separated by aisles). The C-17 is a cargo aircraft: two long rows of side-facing seats along the walls, handled separately. */
const LAYOUT: Record<string, { groups: number[]; pitch: number }> = { a320: { groups: [3, 3], pitch: 0.78 }, b738: { groups: [3, 3], pitch: 0.78 }, a340: { groups: [2, 4, 2], pitch: 0.82 }, a350: { groups: [3, 3, 3], pitch: 0.82 }, c17: { groups: [], pitch: 0.6 } };

/** The cabin of an aircraft from its hull extent (datum frame) and radius. */
export function cabinSpec(id: string, hullX0: number, hullX1: number, radius: number): CabinSpec {
  const l = LAYOUT[id] ?? LAYOUT.a320;
  return { id, x0: hullX0 * 0.74, x1: hullX1 * 0.6, radius, groups: l.groups, pitch: l.pitch };
}
export const floorZ = (s: CabinSpec) => s.radius * 0.33;
export const ceilZ = (s: CabinSpec) => -s.radius * 0.8;
export const halfWidth = (s: CabinSpec) => s.radius * 0.93;
export const EYE_ABOVE_FLOOR = 1.1;

/** Every seat of the cabin, front to back, left (negative y) to right. Letters A, B, C... run from the left window. */
export function seatsOf(s: CabinSpec): Seat[] {
  const out: Seat[] = [];
  if (!s.groups.length) {   // cargo: side-facing seats along both walls
    const n = Math.floor((s.x1 - s.x0) / s.pitch);
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) out.push({ row: i + 1, col: side < 0 ? 0 : 1, letter: side < 0 ? 'L' : 'R', x: s.x1 - (i + 0.5) * s.pitch, y: side * (halfWidth(s) - 0.35), window: true, aisle: true });
    return out;
  }
  const seats = s.groups.reduce((a, b) => a + b, 0), hw = halfWidth(s);
  const seatW = Math.min(0.52, (2 * hw - 0.25 - 0.7 * (s.groups.length - 1)) / seats), aisle = 0.65;
  const total = seats * seatW + (s.groups.length - 1) * aisle;
  const rows = Math.max(1, Math.floor((s.x1 - s.x0) / s.pitch));
  for (let r = 0; r < rows; r++) {
    let y = -total / 2, col = 0;
    s.groups.forEach((g, gi) => { for (let k = 0; k < g; k++) { out.push({ row: r + 1, col, letter: String.fromCharCode(65 + col), x: s.x1 - (r + 0.5) * s.pitch, y: y + seatW * (k + 0.5), window: (gi === 0 && k === 0) || (gi === s.groups.length - 1 && k === g - 1), aisle: (k === g - 1 && gi < s.groups.length - 1) || (k === 0 && gi > 0) }); col++; } y += g * seatW + aisle; });
  }
  return out;
}

/** The eye position (body frame) of a seated passenger. */
export function eyeOf(s: CabinSpec, seat: Seat): [number, number, number] { return [seat.x - (s.groups.length ? 0.12 : 0), seat.y, floorZ(s) - EYE_ABOVE_FLOOR]; }

/** A short list of seats to choose from: window / aisle on each side at the front, middle and rear of the cabin. */
export function seatChoices(s: CabinSpec): { label: string; seat: Seat }[] {
  const all = seatsOf(s), rows = Math.max(...all.map((x) => x.row)), picks: { label: string; seat: Seat }[] = [];
  for (const r of [Math.max(2, Math.round(rows * 0.2)), Math.round(rows * 0.5), Math.max(1, rows - 2)]) {
    for (const k of ['window-left', 'aisle-left', 'aisle-right', 'window-right'] as const) {
      const row = all.filter((x) => x.row === r); if (!row.length) continue;
      const left = k.endsWith('left'), cand = row.filter((x) => (k.startsWith('window') ? x.window : x.aisle && !x.window ? true : x.aisle) && (left ? x.y < 0 : x.y > 0));
      const seat = (k.startsWith('window') ? cand[0] : cand.sort((a, b) => Math.abs(a.y) - Math.abs(b.y))[0]) ?? undefined; if (seat) picks.push({ label: `Row ${r}${seat.letter} (${k.replace('-', ', ')})`, seat });
    }
  }
  return picks;
}

/** A 0.2 x 0.125 m screen facing backwards (-x), width along y, upright (z is down, so the top edge has the smaller z). */
function screenGeometry() {
  const g = new THREE.BufferGeometry(), w = 0.1, h = 0.0625;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -w, -h, 0, w, -h, 0, -w, h, 0, w, h]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2)); g.setIndex([0, 2, 1, 1, 2, 3]); g.computeVertexNormals(); return g;
}
const col = (g: THREE.BufferGeometry, c: [number, number, number]) => { const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); g.deleteAttribute('uv'); return col(g, c); };
/** A box with rounded edges: seats and pillows should not look like crates. */
const rbox = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number], r = 0.025) => { const g = new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z).toNonIndexed(); g.deleteAttribute('uv'); return col(g, c); };
const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, ...o });

/** Placeholder adverts for the seat screens: made-up products, one every few seconds. */
const ADS = [
  { name: 'NIMBUS COFFEE', tag: 'Taste above the clouds', a: '#3a2412', b: '#c8884a', draw: (g: CanvasRenderingContext2D, w: number, h: number) => { g.fillStyle = '#f4efe6'; g.beginPath(); g.ellipse(w * 0.74, h * 0.58, 60, 22, 0, 0, Math.PI * 2); g.fill(); g.fillRect(w * 0.74 - 60, h * 0.38, 120, 54); g.fillStyle = '#5a3418'; g.beginPath(); g.ellipse(w * 0.74, h * 0.38, 60, 20, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#f4efe6'; g.lineWidth = 8; g.beginPath(); g.arc(w * 0.74 + 62, h * 0.5, 22, -1.2, 1.2); g.stroke(); } },
  { name: 'SOLARA', tag: 'SPF everything. Wear the sun.', a: '#ff9a3c', b: '#ffe08a', draw: (g: CanvasRenderingContext2D, w: number, h: number) => { g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(w * 0.76, h * 0.42, 50, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff6d8'; g.lineWidth = 6; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(w * 0.76 + Math.cos(a) * 64, h * 0.42 + Math.sin(a) * 64); g.lineTo(w * 0.76 + Math.cos(a) * 88, h * 0.42 + Math.sin(a) * 88); g.stroke(); } } },
  { name: 'VELOX', tag: 'Run like the flight is leaving', a: '#0a2a5c', b: '#2fb5ff', draw: (g: CanvasRenderingContext2D, w: number, h: number) => { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(w * 0.58, h * 0.7); g.lineTo(w * 0.62, h * 0.48); g.lineTo(w * 0.74, h * 0.46); g.lineTo(w * 0.84, h * 0.6); g.lineTo(w * 0.9, h * 0.7); g.closePath(); g.fill(); g.fillStyle = '#ff4d4d'; g.fillRect(w * 0.58, h * 0.68, w * 0.32, 12); } },
];
export class AdScreen {
  readonly texture: THREE.CanvasTexture; private cv = document.createElement('canvas'); private n = -1;
  constructor() { this.cv.width = 512; this.cv.height = 320; this.texture = new THREE.CanvasTexture(this.cv); this.texture.colorSpace = THREE.SRGBColorSpace; this.draw(0); }
  private draw(i: number) {
    const ad = ADS[i % ADS.length], g = this.cv.getContext('2d')!, w = 512, h = 320;
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, ad.a); gr.addColorStop(1, ad.b); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    ad.draw(g, w, h);
    g.fillStyle = '#ffffff'; g.font = '800 54px system-ui, sans-serif'; g.textBaseline = 'alphabetic'; g.fillText(ad.name, 28, 120);
    g.font = '500 26px system-ui, sans-serif'; g.fillText(ad.tag, 30, 164);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, h - 34, w, 34); g.fillStyle = '#fff'; g.font = '600 15px system-ui, sans-serif'; g.fillText('ADVERTISEMENT  ·  placeholder: the screen shows an invented product', 14, h - 12);
    this.texture.needsUpdate = true;
  }
  /** Call every frame with the time in seconds: the advert changes every 6 s. */
  update(t: number) { const n = Math.floor(t / 6) % ADS.length; if (n !== this.n) { this.n = n; this.draw(n); } }
}

export class Cabin {
  readonly group = new THREE.Group(); readonly ad = new AdScreen();
  readonly seats: Seat[];
  constructor(readonly spec: CabinSpec) {
    this.group.name = 'cabin ' + spec.id;
    const s = spec, hw = halfWidth(s), fz = floorZ(s), cz = ceilZ(s), L = s.x1 - s.x0, xc = (s.x0 + s.x1) / 2;
    this.seats = seatsOf(s);
    const wall = std(0xe9e5da), carpet = std(0x39414f, { roughness: 1 }), ceiling = std(0xf6f4ee, { emissive: 0xfff2dc, emissiveIntensity: 0.18 }), dark = std(0x30333a);
    const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h);
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(g, m); o.receiveShadow = false; this.group.add(o); return o; };
    // floor, an aisle runner
    add(plane(L, 2 * hw * 0.92).translate(xc, 0, fz), carpet);
    add(plane(L, 0.55).translate(xc, 0, fz - 0.012), std(0x6b2230, { roughness: 1 }));
    // side walls: continuous lower and upper bands, pillars between the windows
    const zs = fz - 0.66, zt = fz - 1.2, zUp = fz - 1.5;
    for (const side of [-1, 1]) {
      add(plane(L, zs - fz < 0 ? fz - zs : zs - fz).rotateX(Math.PI / 2).translate(xc, side * hw, (fz + zs) / 2), wall);        // below the windows
      add(plane(L, zt - zUp).rotateX(Math.PI / 2).translate(xc, side * hw, (zt + zUp) / 2), wall);                                // above the windows
      // sloped ceiling panel from the wall top to the central ceiling
      const g = new THREE.BufferGeometry(), y0 = side * hw, y1 = side * hw * 0.5;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([s.x0, y0, zUp, s.x1, y0, zUp, s.x0, y1, cz, s.x1, y1, cz]), 3)); g.setIndex([0, 1, 2, 1, 3, 2]); g.computeVertexNormals(); add(g, ceiling);
    }
    add(plane(L, hw).translate(xc, 0, cz), ceiling);
    // window pillars and frames (instanced): window pitch 0.5 m, 0.3 m wide
    const nWin = Math.floor(L / 0.5), pillar = new THREE.BoxGeometry(0.2, 0.1, zs - zt), pil = new THREE.InstancedMesh(pillar, wall, nWin * 2 + 2); let pi = 0; const mtx = new THREE.Matrix4();
    for (const side of [-1, 1]) for (let i = 0; i <= nWin; i++) { mtx.makeTranslation(s.x0 + i * 0.5, side * (hw - 0.02), (zs + zt) / 2); pil.setMatrixAt(pi++, mtx); }
    pil.count = pi; this.group.add(pil);
    // window sills and tops (thin strips) give the windows a frame
    for (const side of [-1, 1]) { add(box(L, 0.1, 0.04, xc, side * (hw - 0.03), zs, [0.85, 0.83, 0.78]).toNonIndexed(), std(0xffffff, { vertexColors: true })); add(box(L, 0.1, 0.04, xc, side * (hw - 0.03), zt, [0.85, 0.83, 0.78]).toNonIndexed(), std(0xffffff, { vertexColors: true })); }
    // overhead bins
    const nBin = Math.floor(L / 1.7), binG = box(1.62, 0.5, 0.3, 0, 0, 0, [0.92, 0.9, 0.85]), bins = new THREE.InstancedMesh(binG, std(0xffffff, { vertexColors: true }), nBin * 2);
    let bi = 0; const ang = Math.atan2(hw * 0.5, zUp - cz);
    for (const side of [-1, 1]) for (let i = 0; i < nBin; i++) { mtx.compose(new THREE.Vector3(s.x0 + 0.9 + i * 1.7, side * hw * 0.74, (zUp + cz) / 2 + 0.06), new THREE.Quaternion().setFromEuler(new THREE.Euler(side * ang * -0.55, 0, 0)), new THREE.Vector3(1, 1, 1)); bins.setMatrixAt(bi++, mtx); }
    this.group.add(bins);
    // light strip along the ceiling and reading lights
    add(box(L, 0.12, 0.02, xc, 0, cz + 0.01, [1, 0.97, 0.9]).toNonIndexed(), std(0xffffff, { vertexColors: true, emissive: 0xfff0d0, emissiveIntensity: 1.1 }));
    // bulkheads (galley walls) with a door panel
    for (const x of [s.x0, s.x1]) { add(plane(2 * hw * 0.95, fz - cz).rotateY(Math.PI / 2).translate(x, 0, (fz + cz) / 2), wall); add(plane(0.9, 1.9).rotateY(Math.PI / 2).translate(x + (x === s.x0 ? -0.01 : 0.01), 0, fz - 0.95), dark); }
    // seats: one merged geometry, instanced, tinted by the instance colour; seat-back screens
    const seatG = mergeGeometries([rbox(0.46, 0.5, 0.11, 0, 0, fz - 0.42, [0.8, 0.8, 0.85], 0.04), rbox(0.1, 0.5, 0.7, -0.2, 0, fz - 0.8, [1, 1, 1], 0.045), rbox(0.11, 0.34, 0.22, -0.22, 0, fz - 1.24, [1.5, 1.5, 1.6], 0.05), box(0.025, 0.36, 0.22, -0.268, 0, fz - 0.68, [0.5, 0.5, 0.54]),
      rbox(0.42, 0.06, 0.06, 0, 0.27, fz - 0.6, [0.12, 0.12, 0.14], 0.02), rbox(0.42, 0.06, 0.06, 0, -0.27, fz - 0.6, [0.12, 0.12, 0.14], 0.02), box(0.36, 0.36, 0.34, 0, 0, fz - 0.17, [0.1, 0.1, 0.12])])!;
    const seatM = new THREE.InstancedMesh(seatG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), Math.max(1, this.seats.length * (s.groups.length ? 1 : 1)));
    const fabric = new THREE.Color(0x27406e); let n = 0;
    for (const seat of this.seats) {
      if (!s.groups.length) { mtx.compose(new THREE.Vector3(seat.x, seat.y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, seat.col === 0 ? -Math.PI / 2 : Math.PI / 2)), new THREE.Vector3(1, 1, 1)); } else mtx.makeTranslation(seat.x, seat.y, 0);
      seatM.setMatrixAt(n, mtx); seatM.setColorAt(n, s.groups.length ? fabric : this.col(0xb02a1f)); n++;
    }
    seatM.count = n; this.group.add(seatM);
    if (s.groups.length) {
      const screenM = new THREE.MeshBasicMaterial({ map: this.ad.texture, side: THREE.DoubleSide, toneMapped: false }), screens = new THREE.InstancedMesh(screenGeometry(), screenM, this.seats.length);
      let k = 0; const maxRow = Math.max(...this.seats.map((q) => q.row));
      for (const seat of this.seats) { if (seat.row === maxRow) continue; mtx.makeTranslation(seat.x - s.pitch - 0.26, seat.y, fz - 0.98); screens.setMatrixAt(k++, mtx); }   // on the back of the seat in front of the one behind
      screens.count = k; this.group.add(screens);
    }
    // cabin light (the world's sun reaches the cabin only through the windows)
    this.group.add(new THREE.HemisphereLight(0xfff4e2, 0x6a7080, 0.5));
    for (let i = 0; i < 4; i++) { const p = new THREE.PointLight(0xfff0d6, 7, 9, 1.6); p.position.set(s.x0 + (L * (i + 0.5)) / 4, 0, cz + 0.35); this.group.add(p); }
  }
  /** The wings and engines outside the windows (simple slabs): visible from the window seats beside and behind the wing root. */
  addWings() {
    const s = this.spec, r = s.radius, fz = floorZ(s), L = s.x1;
    const half = 8.4 * r, rootLE = 0.42 * L, chord = 3.1 * r, sweep = 4.2 * r, tipChord = 0.95 * r, thick = 0.22;
    const m = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.55, metalness: 0.2 }), dark = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.5, metalness: 0.4 });
    for (const side of [-1, 1]) {
      // planform in (x, y) of the aircraft, extruded down (z is down in the body frame: the slab spans z .. z + thickness)
      const shape = new THREE.Shape(); shape.moveTo(rootLE, 0); shape.lineTo(rootLE - sweep, half); shape.lineTo(rootLE - sweep - tipChord, half); shape.lineTo(rootLE - chord, 0); shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }); g.scale(1, side, 1); const o = new THREE.Mesh(g, m); o.position.set(0, side * (r * 0.9), fz + 0.1 + 0.0); this.group.add(o);
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.62 * r * 0.5, 0.55 * r * 0.5, 3.0 * r * 0.55, 16).rotateZ(Math.PI / 2), dark); nacelle.position.set(rootLE - 1.4 * r, side * (r * 0.9 + 0.38 * half), fz + 0.1 + thick + 0.55 * r * 0.55); this.group.add(nacelle);
    }
  }
  /** Passengers in about 65 % of the seats (not the one you are in), seated and facing forward. */
  addPassengers(exceptRow: number, exceptCol: number, seed = 7) {
    if (!this.spec.groups.length) return;
    const rnd = rng(seed), fz = floorZ(this.spec), people: Person[] = [];
    for (const seat of this.seats) { if ((seat.row === exceptRow && seat.col === exceptCol) || rnd() > 0.65) continue; people.push({ x: seat.x + 0.02, z: seat.y, y: 0.47, yaw: Math.PI / 2, seated: true, cloth: Math.floor(rnd() * 10), skin: Math.floor(rnd() * 6) }); }
    // the seated body is built in a local frame with +z forward; here the aircraft frame has x forward, y right and z DOWN, so people are placed in the body frame via a rotated group
    this.pax?.dispose(); if (this.pax) this.group.remove(this.pax.group);
    const pf = new PeopleField(people.map((p) => ({ ...p, x: p.x, z: p.z }))); this.pax = pf;
    // PeopleField works in a y-up frame (x forward, z to the right, y up from the floor); the matrix maps it to the body frame: (x, y, z) -> (x, z, floor - y)
    pf.group.matrixAutoUpdate = false; pf.group.matrix.set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, fz, 0, 0, 0, 1); this.group.add(pf.group);
  }
  pax: PeopleField | null = null;
  private col(h: number) { return new THREE.Color(h); }
  update(t: number) { this.ad.update(t); }
  dispose() { this.group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); this.ad.texture.dispose(); }
}
