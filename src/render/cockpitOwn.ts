// Original Boeing 737 flight deck, modelled and textured in code for this project (no third-party assets).
// Everything is in the aircraft body frame (x forward, y right, z down, metres); the captain sits at y < 0.
// Proportions follow public 737NG flight-deck layout: glareshield, sloped main panel with six displays,
// centre pedestal with thrust levers, overhead panel, side consoles, window posts. Control wheels, thrust
// levers, speedbrake, flap lever, gear lever and trim wheels move with the simulation.

import * as THREE from 'three';
import type { FlightControls } from '../sim/controls';

const PW = 2.6, PH = 0.62; // main panel width / height (m)
const TOP = new THREE.Vector3(15.28, 0, -0.46), SLOPE = new THREE.Vector3(-0.30, 0, 0.954);
/** Point on the main panel: u = lateral (m, + right), v = distance down the slope from the top edge (m). */
const P = (u: number, v: number) => new THREE.Vector3(TOP.x + SLOPE.x * v, u, TOP.z + SLOPE.z * v);

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; }
function tex(c: HTMLCanvasElement) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number) {
  for (let i = 0; i < n; i++) { const v = Math.random() * 255; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
}
function label(g: CanvasRenderingContext2D, s: string, x: number, y: number, px = 11, col = '#9aa0a6', align: CanvasTextAlign = 'center') {
  g.fillStyle = col; g.font = `600 ${px}px Arial, Helvetica, sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
}
function knob(g: CanvasRenderingContext2D, x: number, y: number, r: number, mark = 0) {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gr.addColorStop(0, '#6c7178'); gr.addColorStop(1, '#17191b');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9dde0'; g.lineWidth = Math.max(1.5, r * 0.18); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(mark) * r * 0.9, y - Math.cos(mark) * r * 0.9); g.stroke();
}
function btn(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, txt: string, lit?: string) {
  g.fillStyle = '#34383d'; g.fillRect(x, y, w, h); g.strokeStyle = '#0c0d0e'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
  if (lit) { g.fillStyle = lit; g.fillRect(x + 3, y + h - 6, w - 6, 3); }
  label(g, txt, x + w / 2, y + h / 2 - 2, 8, '#d6d9dc');
}
function dial(g: CanvasRenderingContext2D, x: number, y: number, r: number, kind: 'att' | 'asi' | 'alt') {
  g.fillStyle = '#070809'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#6a6f75'; g.lineWidth = 3; g.stroke();
  if (kind === 'att') {
    g.save(); g.beginPath(); g.arc(x, y, r - 4, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2f7fc4'; g.fillRect(x - r, y - r, 2 * r, r); g.fillStyle = '#a56a2c'; g.fillRect(x - r, y, 2 * r, r);
    g.fillStyle = '#fff'; g.fillRect(x - r, y - 1, 2 * r, 2); g.restore();
    g.fillStyle = '#ffd24a'; g.fillRect(x - r * 0.5, y - 1.5, r * 0.3, 3); g.fillRect(x + r * 0.2, y - 1.5, r * 0.3, 3);
  } else {
    g.strokeStyle = '#d6d9dc'; g.fillStyle = '#d6d9dc'; g.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(x + Math.sin(a) * (r - 4), y - Math.cos(a) * (r - 4)); g.lineTo(x + Math.sin(a) * (r - 11), y - Math.cos(a) * (r - 11)); g.stroke(); }
    label(g, kind === 'asi' ? 'KT' : 'FT', x, y + r * 0.45, 9, '#d6d9dc');
    g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(kind === 'asi' ? 2.2 : 0.6) * (r - 10), y - Math.cos(kind === 'asi' ? 2.2 : 0.6) * (r - 10)); g.stroke();
  }
}

function mainPanelTexture() {
  const W = 2080, H = Math.round((W * PH) / PW);
  const [c, g] = canvas(W, H);
  const X = (u: number) => ((u + PW / 2) / PW) * W, Y = (v: number) => (v / PH) * H, S = (m: number) => (m / PW) * W;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#2d3034'); gr.addColorStop(1, '#202327');
  g.fillStyle = gr; g.fillRect(0, 0, W, H); speckle(g, W, H, 9000, 0.05);
  // display bezels
  const bez = (u: number, v: number, s: number) => { g.fillStyle = '#0a0b0c'; g.fillRect(X(u) - S(s / 2 + 0.012), Y(v) - S(s / 2 + 0.012), S(s + 0.024), S(s + 0.024)); g.strokeStyle = '#4a4e53'; g.lineWidth = 2; g.strokeRect(X(u) - S(s / 2 + 0.012), Y(v) - S(s / 2 + 0.012), S(s + 0.024), S(s + 0.024)); g.fillStyle = '#000'; g.fillRect(X(u) - S(s / 2), Y(v) - S(s / 2), S(s), S(s)); };
  for (const [u, v] of DISPLAYS) bez(u, v, 0.2);
  // panel sections: outlines and labels
  g.strokeStyle = '#15171a'; g.lineWidth = 2;
  for (const u of [-1.05, -0.38, 0.38, 1.05]) { g.beginPath(); g.moveTo(X(u), 0); g.lineTo(X(u), H); g.stroke(); }
  g.beginPath(); g.moveTo(0, Y(0.32)); g.lineTo(W, Y(0.32)); g.stroke();
  for (const side of [-1, 1]) {
    const u0 = side * 0.92;
    label(g, 'ANTI-SKID', X(u0 - 0.2), Y(0.38), 10); label(g, 'AUTO BRAKE', X(u0 - 0.2), Y(0.5), 10);
    knob(g, X(u0 - 0.2), Y(0.45), S(0.02), side * 0.4);
    for (let i = 0; i < 4; i++) btn(g, X(u0 - 0.05 + i * 0.075), Y(0.4), S(0.062), S(0.04), ['MASTER', 'CAUTION', 'FIRE', 'RECALL'][i], i === 2 ? '#c0392b' : '#d29a1c');
    for (let i = 0; i < 6; i++) { knob(g, X(u0 - 0.05 + i * 0.05), Y(0.52), S(0.016), i * 0.5); label(g, ['HDG', 'ALT', 'CRS', 'V/S', 'SPD', 'BARO'][i], X(u0 - 0.05 + i * 0.05), Y(0.565), 8); }
  }
  // standby instruments and gear panel in the centre
  dial(g, X(-0.27), Y(0.12), S(0.052), 'att'); dial(g, X(-0.27), Y(0.265), S(0.05), 'asi'); dial(g, X(0.27), Y(0.12), S(0.05), 'alt');
  label(g, 'GEAR', X(0.27), Y(0.215), 11, '#d6d9dc');
  g.fillStyle = '#0a0b0c'; g.fillRect(X(0.27) - S(0.03), Y(0.235), S(0.06), S(0.09)); // gear lever slot
  for (const [i, col] of [['#2fc25b', 'NOSE'], ['#2fc25b', 'LEFT'], ['#2fc25b', 'RIGHT']].map((x, i) => [i, x] as const)) { g.fillStyle = col[0]; g.fillRect(X(0.1) + i * S(0.045), Y(0.3), S(0.034), S(0.02)); label(g, col[1], X(0.1) + i * S(0.045) + S(0.017), Y(0.335), 7); }
  label(g, 'FLAPS', X(0.27), Y(0.43), 10); label(g, 'SPEED BRAKE', X(-0.27), Y(0.44), 10);
  // outer rows of lights and switches
  for (let r = 0; r < 3; r++) for (let i = 0; i < 24; i++) { g.fillStyle = (i + r) % 7 === 0 ? '#2fc25b' : (i + r) % 11 === 0 ? '#d29a1c' : '#101214'; g.fillRect(X(-0.37) + i * S(0.0155), Y(0.5 + r * 0.035), S(0.012), S(0.014)); }
  label(g, 'BOEING 737-800', X(0), Y(0.58), 12, '#6c7178');
  return tex(c);
}
const DISPLAYS: [number, number][] = [[-0.80, 0.17], [-0.56, 0.17], [0, 0.17], [0, 0.37], [0.56, 0.17], [0.80, 0.17]];

function overheadTexture() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#26292d'; g.fillRect(0, 0, 1024, 1024); speckle(g, 1024, 1024, 12000, 0.05);
  const secs = ['ELEC', 'FUEL', 'HYD', 'APU', 'ENG START', 'ANTI-ICE', 'AIR COND', 'PRESS', 'LIGHTS', 'FLT CONTROL', 'IRS', 'NAV'];
  secs.forEach((s, i) => {
    const x = 36 + (i % 4) * 246, y = 36 + Math.floor(i / 4) * 316;
    g.strokeStyle = '#8b9096'; g.lineWidth = 2; g.strokeRect(x, y, 230, 300); label(g, s, x + 115, y + 18, 15, '#d6d9dc');
    for (let k = 0; k < 8; k++) { const px = x + 30 + (k % 4) * 52, py = y + 70 + Math.floor(k / 4) * 120; knob(g, px, py, 14, (k - 3) * 0.5); label(g, ['ON', 'OFF', 'AUTO', 'BAT', 'GEN', 'PUMP', 'VALVE', 'TEST'][k], px, py + 28, 9); }
    for (let k = 0; k < 4; k++) { g.fillStyle = k === 1 ? '#d29a1c' : '#1b1d20'; g.fillRect(x + 20 + k * 54, y + 260, 40, 20); label(g, 'LOW', x + 40 + k * 54, y + 270, 8, '#cfd3d6'); }
  });
  return tex(c);
}

function pedestalTexture() {
  const [c, g] = canvas(300, 1000);
  g.fillStyle = '#34383d'; g.fillRect(0, 0, 300, 1000); speckle(g, 300, 1000, 5000, 0.06);
  for (const x of [20, 160]) { // two CDUs
    g.fillStyle = '#050607'; g.fillRect(x, 20, 120, 120); g.fillStyle = '#9cf0a8'; g.font = '700 12px monospace'; g.textAlign = 'left';
    ['  THRUST LIM', ' TO 1  24K', ' RTE   POS INIT', ' <INDEX     ACT>'].forEach((t, i) => g.fillText(t, x + 6, 40 + i * 26));
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) btn(g, x + k * 31, 150 + r * 28, 28, 24, 'ABCDEFGH'[(r * 4 + k) % 8]);
  }
  for (let i = 0; i < 3; i++) { g.fillStyle = '#0a0b0c'; g.fillRect(20, 330 + i * 70, 260, 14); }
  for (let i = 0; i < 2; i++) { g.fillStyle = '#050607'; g.fillRect(20 + i * 140, 560, 120, 40); g.fillStyle = '#f0b429'; g.font = '700 22px monospace'; g.fillText(['118.30', '121.50'][i], 32 + i * 140, 588); label(g, ['COM1', 'COM2'][i], 80 + i * 140, 548, 11); }
  label(g, 'TRANSPONDER', 150, 640, 12); knob(g, 80, 690, 24, 0.3); knob(g, 220, 690, 24, -0.4);
  label(g, 'STAB TRIM', 150, 800, 12); label(g, 'PARKING BRAKE', 150, 900, 12);
  g.fillStyle = '#6b2020'; g.fillRect(100, 915, 100, 22);
  return tex(c);
}

function gloss() { return new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }); }

export class CockpitOwn {
  readonly root = new THREE.Group();
  private yokes: { g: THREE.Group; base: number }[] = [];
  private throttle: THREE.Group[] = [];
  private speedbrake = new THREE.Group();
  private flap = new THREE.Group();
  private gear = new THREE.Group();
  private trim: THREE.Group[] = [];
  private gearPos = 0; private sbPos = 0; private flapPos = 0;

  constructor(live: THREE.Texture, crops: { pfd: number[]; nd: number[]; eng: number[]; mcp: number[] }, cw: number, ch: number) {
    const R = this.root;
    const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.8, emissive: 0x050607 });
    const mid = new THREE.MeshStandardMaterial({ color: 0x3a3e43, roughness: 0.75, emissive: 0x070809 });
    const light = new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.9, emissive: 0x0d0e10 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.6 });
    const box = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, parent: THREE.Object3D = R) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m); b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); parent.add(b); return b;
    };
    const post = (m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, w: number, d: number) => {
      const len = a.distanceTo(b), p = new THREE.Mesh(new THREE.BoxGeometry(d, w, len), m);
      p.position.copy(a).add(b).multiplyScalar(0.5);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize()); R.add(p); return p;
    };
    // ---- shell: floor, back bulkhead, side walls below the windows, ceiling, side windows' frames
    box(new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 1 }), 12.4, 15.3, -1.5, 1.5, 0.42, 0.46);
    box(dark, 12.35, 12.4, -1.5, 1.5, -1.3, 0.46);
    for (const s of [-1, 1]) {
      box(light, 12.4, 15.3, s * 1.5 - 0.03, s * 1.5 + 0.03, -0.42, 0.44); // wall below the window
      box(mid, 12.4, 15.3, s * 1.5 - 0.03, s * 1.5 + 0.03, -1.32, -1.12);   // wall above the window
      post(dark, new THREE.Vector3(13.65, s * 1.5, -0.42), new THREE.Vector3(13.65, s * 1.5, -1.12), 0.09, 0.07); // B pillar
      post(dark, new THREE.Vector3(14.95, s * 1.42, -0.46), new THREE.Vector3(14.55, s * 1.5, -1.12), 0.09, 0.07); // side window front frame
      box(mid, 14.4, 15.3, s * 1.42, s * 1.5, -0.48, -0.40); // console wall at the panel end
    }
    box(dark, 12.4, 15.05, -1.55, 1.55, -1.34, -1.28); // ceiling
    // ---- windshield frame (open): header, A pillars, centre post
    post(black, new THREE.Vector3(14.78, -1.45, -1.18), new THREE.Vector3(14.78, 1.45, -1.18), 0.1, 0.08);
    for (const y of [-1.0, 1.0]) post(dark, P(y * 1.04, 0).add(new THREE.Vector3(0, 0, -0.04)), new THREE.Vector3(14.78, y, -1.18), 0.075, 0.075);
    post(dark, P(0, 0).add(new THREE.Vector3(0, 0, -0.04)), new THREE.Vector3(14.78, 0, -1.18), 0.035, 0.035);
    post(black, new THREE.Vector3(15.05, -1.45, -0.5), new THREE.Vector3(15.05, 1.45, -0.5), 0.05, 0.05);
    // ---- glareshield + main panel
    box(black, 15.0, 15.36, -1.45, 1.45, -0.52, -0.44);
    const mp = mainPanelTexture();
    const pm = new THREE.MeshStandardMaterial({ map: mp, roughness: 0.9, emissive: 0x0a0b0c, emissiveMap: mp, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    this.quad(pm, P(-PW / 2, 0), P(PW / 2, 0), P(-PW / 2, PH), P(PW / 2, PH), [0, 1, 0, 1]);
    box(dark, 14.3, 15.05, -1.45, 1.45, 0.18, 0.46); // panel bottom / footwell front
    // ---- live displays on the six bezels + MCP
    const dn = (u: number, v: number, s: number, rect: number[]) => this.quad(new THREE.MeshBasicMaterial({ map: live, toneMapped: false, side: THREE.DoubleSide }),
      P(u - s / 2, v - s / 2).add(new THREE.Vector3(-0.004, 0, 0)), P(u + s / 2, v - s / 2).add(new THREE.Vector3(-0.004, 0, 0)), P(u - s / 2, v + s / 2).add(new THREE.Vector3(-0.004, 0, 0)), P(u + s / 2, v + s / 2).add(new THREE.Vector3(-0.004, 0, 0)),
      [rect[0] / cw, (rect[0] + rect[2]) / cw, 1 - (rect[1] + rect[3]) / ch, 1 - rect[1] / ch]);
    dn(-0.80, 0.17, 0.2, crops.pfd); dn(-0.56, 0.17, 0.2, crops.nd); dn(0, 0.17, 0.2, crops.eng); dn(0, 0.37, 0.2, [crops.eng[0], crops.eng[1], crops.eng[2], crops.eng[3]]); dn(0.56, 0.17, 0.2, crops.nd); dn(0.80, 0.17, 0.2, crops.pfd);
    this.quad(new THREE.MeshBasicMaterial({ map: live, toneMapped: false, side: THREE.DoubleSide }), new THREE.Vector3(15.06, -0.46, -0.526), new THREE.Vector3(15.06, 0.46, -0.526), new THREE.Vector3(15.15, -0.46, -0.526), new THREE.Vector3(15.15, 0.46, -0.526),
      [crops.mcp[0] / cw, (crops.mcp[0] + crops.mcp[2]) / cw, 1 - (crops.mcp[1] + crops.mcp[3]) / ch, 1 - crops.mcp[1] / ch]);
    // ---- overhead panel (with instanced toggle switches on its underside)
    const oh = overheadTexture();
    const ohA = new THREE.Vector3(14.9, -0.62, -1.12), ohB = new THREE.Vector3(14.9, 0.62, -1.12), ohC = new THREE.Vector3(13.7, -0.62, -1.3), ohD = new THREE.Vector3(13.7, 0.62, -1.3);
    this.quad(new THREE.MeshStandardMaterial({ map: oh, roughness: 0.8, emissive: 0x111214, emissiveMap: oh, emissiveIntensity: 0.5, side: THREE.DoubleSide }), ohA, ohB, ohC, ohD, [0, 1, 0, 1]);
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.01, 0.035, 6), new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.4, metalness: 0.5 }), 96);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 96; i++) { const u = ((i % 16) + 0.5) / 16, v = (Math.floor(i / 16) + 0.5) / 6; const p = ohA.clone().lerp(ohB, u).lerp(ohC.clone().lerp(ohD, u), v); m4.makeTranslation(p.x, p.y, p.z + 0.02 + Math.random() * 0.01); caps.setMatrixAt(i, m4); }
    R.add(caps);
    // ---- pedestal with thrust levers, speedbrake, flaps, trim wheels
    const pt = pedestalTexture();
    box(mid, 13.55, 14.95, -0.2, 0.2, 0.0, 0.44);
    this.quad(new THREE.MeshStandardMaterial({ map: pt, roughness: 0.8, emissive: 0x101112, emissiveMap: pt, emissiveIntensity: 0.5, side: THREE.DoubleSide }), new THREE.Vector3(14.95, -0.2, -0.003), new THREE.Vector3(14.95, 0.2, -0.003), new THREE.Vector3(13.55, -0.2, -0.003), new THREE.Vector3(13.55, 0.2, -0.003), [0, 1, 0, 1]);
    const lever = (len: number, mat: THREE.Material, knobMat: THREE.Material, x: number, y: number) => {
      const g = new THREE.Group(); g.position.set(x, y, -0.003);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, len, 8), mat); rod.rotation.x = Math.PI / 2; rod.position.z = -len / 2; g.add(rod);
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.034, 0.05), knobMat); k.position.z = -len - 0.02; g.add(k); R.add(g); return g;
    };
    for (const y of [-0.06, 0.06]) this.throttle.push(lever(0.2, light, mid, 14.35, y));
    this.speedbrake = lever(0.17, light, new THREE.MeshStandardMaterial({ color: 0x9a2f2f, roughness: 0.6 }), 14.55, -0.15);
    this.flap = lever(0.14, light, new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.6 }), 14.62, 0.15);
    for (const s of [-1, 1]) { const w = new THREE.Group(); w.position.set(14.0, s * 0.215, 0.1); const d = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 18), black); w.add(d); const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.034, 0.02), light); t.position.set(0.07, 0, 0); w.add(t); R.add(w); this.trim.push(w); }
    // ---- gear lever on the main panel
    { this.gear.position.copy(P(0.27, 0.285)).add(new THREE.Vector3(-0.012, 0, 0)); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8), light); rod.rotation.z = Math.PI / 2; rod.position.x = -0.035; this.gear.add(rod); const k = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.4 })); k.position.x = -0.08; this.gear.add(k); R.add(this.gear); }
    // ---- seats, side consoles, control columns
    for (const s of [-1, 1]) {
      const seat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.95 });
      box(seat, 13.1, 13.6, s * 0.53 - 0.24, s * 0.53 + 0.24, 0.18, 0.28); box(seat, 13.0, 13.12, s * 0.53 - 0.23, s * 0.53 + 0.23, -0.5, 0.2);
      box(mid, 13.7, 14.85, s * 1.0, s * 1.4, 0.05, 0.44); // side console
      const til = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), light); til.position.set(14.5, s * 1.15, 0.0); R.add(til);
      const col = new THREE.Group(); col.position.set(14.72, s * 0.53, 0.0); R.add(col);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.45, 10), dark); shaft.position.z = 0.22; col.add(shaft);
      // Boeing-style control yoke: a U/butterfly shaped bar with an upturned grip on each side, not a round wheel
      const wheel = new THREE.Group(); wheel.position.set(-0.05, 0, -0.06);
      const half = (sgn: number) => new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, sgn * 0.0, 0.06), new THREE.Vector3(0, sgn * 0.09, 0.075), new THREE.Vector3(0, sgn * 0.17, 0.045),
        new THREE.Vector3(0, sgn * 0.205, -0.03), new THREE.Vector3(0, sgn * 0.195, -0.11),
      ]);
      for (const sg of [-1, 1]) {
        wheel.add(new THREE.Mesh(new THREE.TubeGeometry(half(sg), 20, 0.015, 8), black));
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.1, 10), dark); grip.position.set(0, sg * 0.197, -0.095); grip.rotation.x = 0.06 * sg; wheel.add(grip);
        const btn = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.02), light); btn.position.set(-0.022, sg * 0.197, -0.12); wheel.add(btn);
      }
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.11), dark); hub.position.set(0, 0, 0.04); wheel.add(hub);
      const dial = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.075, 0.05), new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.5 })); dial.position.set(-0.04, 0, 0.04); wheel.add(dial);
      col.add(wheel); this.yokes.push({ g: col, base: 14.72 });
      (col as THREE.Group & { wheel?: THREE.Group }).wheel = wheel;
    }
    R.traverse((o) => { o.frustumCulled = false; });
    void gloss;
  }

  private quad(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv: number[]) {
    // a = left/top, b = right/top, c = left/bottom, d = right/bottom; uv = [u0, u1, v0 (bottom), v1 (top)]
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray()], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[3], uv[1], uv[3], uv[0], uv[2], uv[1], uv[2]], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); this.root.add(m); return m;
  }

  update(dt: number, c: FlightControls, eff: { pitch: number; roll: number }) {
    const k = 1 - Math.exp(-dt * 8);
    for (const y of this.yokes) {
      y.g.position.x = y.base - eff.pitch * 0.05;
      (y.g as THREE.Group & { wheel?: THREE.Group }).wheel!.rotation.x = eff.roll * 1.2;
    }
    const thr = -0.12 - c.throttle * 0.7;
    for (const t of this.throttle) t.rotation.y = thr;
    this.sbPos += (c.speedbrake - this.sbPos) * k; this.speedbrake.rotation.y = -0.15 + 0.8 * this.sbPos;
    this.flapPos += (c.flapLever - this.flapPos) * k; this.flap.rotation.y = -0.12 + 0.11 * this.flapPos;
    this.gearPos += ((c.gearDown ? 0 : 1) - this.gearPos) * k;
    this.gear.position.copy(P(0.27, 0.285 - this.gearPos * 0.05)).add(new THREE.Vector3(-0.012, 0, 0));
    for (const w of this.trim) w.rotation.y = c.trim * 8;
  }
}
