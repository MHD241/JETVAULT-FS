// Boeing 737-800 flight deck (captain side): glass PFD, ND, engine display and an MCP on
// the glareshield. Every value comes from the simulation (instrument indications, engine
// and autopilot state). The autopilot behind the MCP is the same servo-driven two-axis
// autopilot used for the C172 (HDG SEL / ALT HOLD / V/S); LNAV, VNAV, autothrottle and
// approach modes are NOT implemented and are not drawn.

import * as THREE from 'three';
import { Simulation } from '../sim/simulation';
import { Region } from './cockpit';
import { AirportData } from '../world/airport';

const PX = 1400; // px per metre
const W = 1.6, H = 0.62;
const CW = Math.round(W * PX), CH = Math.round(H * PX); // 2240 x 868
const PANEL_X = 14.9, PANEL_TOP = 0.35; // body x; height above the datum (up)

export class B737Cockpit {
  readonly root = new THREE.Group();
  readonly panelMesh: THREE.Mesh;
  readonly knobs: THREE.Mesh[] = [];
  regions: Region[] = [];
  hover: Region | null = null;
  private pressed: Region | null = null;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private timer = 0;
  private yoke = new THREE.Group();
  private thrustLevers: THREE.Mesh[] = [];

  constructor(private sim: Simulation, private airport: AirportData) {
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    this.g = cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    // displays are self-luminous LCDs: unlit, not tone-mapped
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    this.panelMesh.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
    this.panelMesh.position.set(PANEL_X - 0.003, -0.35, -(PANEL_TOP - H / 2));
    this.root.add(this.panelMesh);
    this.buildInterior();
    this.buildRegions();
  }

  private buildInterior() {
    const plastic = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.8 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.85 });
    const box = (x0: number, x1: number, y0: number, y1: number, u0: number, u1: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, u1 - u0), m);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, -(u0 + u1) / 2);
      this.root.add(b);
      return b;
    };
    box(PANEL_X, PANEL_X + 0.1, -1.6, 1.6, PANEL_TOP - 0.9, PANEL_TOP, darkM); // main panel
    box(PANEL_X, PANEL_X + 0.35, -1.5, 1.5, PANEL_TOP, PANEL_TOP + 0.05, plastic); // glareshield
    box(14.2, 15.0, -0.35, 0.35, -0.75, -0.2, plastic); // control stand
    box(12.0, 16.0, -1.75, 1.75, -1.05, -1.0, darkM); // floor
    for (const s of [-1, 1]) box(12.0, 16.2, s * 1.75 - 0.03, s * 1.75 + 0.03, -1.0, 0.2, plastic); // side walls below the windows
    box(12.0, 16.0, -1.75, 1.75, 1.3, 1.35, plastic); // ceiling
    // window frames
    const post = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), plastic);
      p.position.copy(a).add(b).multiplyScalar(0.5);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
      this.root.add(p);
    };
    for (const s of [-1, 1]) {
      post(new THREE.Vector3(15.25, s * 0.15, -0.42), new THREE.Vector3(15.95, s * 0.12, -1.25));
      post(new THREE.Vector3(15.15, s * 1.15, -0.42), new THREE.Vector3(15.75, s * 0.85, -1.25));
      post(new THREE.Vector3(14.4, s * 1.6, -0.3), new THREE.Vector3(14.6, s * 1.3, -1.28));
    }
    // captain's control column
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), plastic);
    shaft.position.z = 0.25; this.yoke.add(shaft);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 24, Math.PI * 1.3), darkM);
    wheel.rotation.y = Math.PI / 2; wheel.rotation.x = Math.PI * 0.85; wheel.position.z = -0.02;
    this.yoke.add(wheel);
    this.yoke.position.set(14.55, -0.53, 0.2);
    this.root.add(this.yoke);
    // thrust levers (draggable)
    for (const y of [-0.08, 0.08]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.18), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      t.position.set(14.6, y, -0.25 - 0.09);
      t.name = 'throttle';
      this.root.add(t);
      this.knobs.push(t);
      this.thrustLevers.push(t);
    }
  }

  // ---------------------------------------------------------------- layout & MCP
  private L = { pfd: [110, 230, 520, 520], nd: [660, 230, 520, 520], eng: [1280, 230, 420, 520], mcp: [380, 40, 1480, 120] };

  private buildRegions() {
    const sim = this.sim, ap = sim.autopilot;
    const c = () => sim.controls;
    const R = (id: string, x: number, y: number, w: number, h: number, tip: string, act: Region['act']) => this.regions.push({ id, x, y, w, h, tip, act });
    const [mx, my] = this.L.mcp;
    R('mcp-hdgknob', mx + 470, my + 30, 80, 80, 'Heading selector (wheel or click)', (d) => { c().headingBug = (c().headingBug + d * 5 + 360) % 360; });
    R('mcp-hdgsel', mx + 560, my + 55, 90, 50, 'HDG SEL', (_d, ph) => { if (ph === 'down' && ap.engaged) ap.lateral = ap.lateral === 'HDG' ? 'ROL' : 'HDG'; });
    R('mcp-altknob', mx + 760, my + 30, 80, 80, 'Altitude selector (wheel or click)', (d) => { ap.targetAltFt = Math.max(0, ap.targetAltFt + d * 100); });
    R('mcp-althold', mx + 850, my + 55, 90, 50, 'ALT HOLD', (_d, ph) => { if (ph === 'down' && ap.engaged) { if (ap.vertical === 'ALT') ap.vertical = 'VS'; else ap.holdAltitude(sim.systems); } });
    R('mcp-vswheel', mx + 1010, my + 25, 60, 90, 'Vertical speed wheel (wheel or click)', (d) => { ap.targetVsFpm += d * 100; });
    R('mcp-vs', mx + 1080, my + 55, 70, 50, 'V/S', (_d, ph) => { if (ph === 'down' && ap.engaged) ap.vertical = 'VS'; });
    R('mcp-cmda', mx + 1250, my + 30, 100, 60, 'CMD A (autopilot engage / disengage)', (_d, ph) => { if (ph === 'down') { if (ap.engaged) ap.disengage('Pilot'); else ap.engage(sim.systems); } });
    R('gear', 1760, 560, 120, 220, 'Landing gear lever: click to raise / lower', (_d, ph) => { if (ph === 'down') c().gearDown = !c().gearDown; });
    R('flaps', 1920, 560, 120, 220, 'Flap lever: upper half retract, lower half extend', (d, ph) => { if (ph === 'down') c().flapLever = Math.max(0, Math.min(8, c().flapLever + d)); });
    R('sbrake', 2070, 560, 120, 220, 'Speedbrake: click to cycle 0 / flight detent / up', (_d, ph) => { if (ph === 'down') c().speedbrake = c().speedbrake < 0.1 ? 0.5 : c().speedbrake < 0.9 ? 1 : 0; });
    R('pbrake', 1760, 800, 200, 50, 'Parking brake', (_d, ph) => { if (ph === 'down') c().parkingBrake = !c().parkingBrake; });
  }

  interact(uv: THREE.Vector2, phase: 'down' | 'up' | 'wheel' | 'move', dir = 0): Region | null {
    const px = uv.x * CW, py = (1 - uv.y) * CH;
    const r = this.regions.find((q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h) ?? null;
    if (phase === 'move') { this.hover = r; return r; }
    if (phase === 'up') { if (this.pressed) { this.pressed.act(0, 'up'); this.pressed = null; } return r; }
    if (!r) return null;
    const d = phase === 'wheel' ? dir : r.id === 'flaps' ? (py < r.y + r.h / 2 ? -1 : 1) : px < r.x + r.w / 2 ? -1 : 1;
    r.act(d, phase === 'wheel' ? 'wheel' : 'down');
    return r;
  }
  releaseAll() { if (this.pressed) { this.pressed.act(0, 'up'); this.pressed = null; } }

  update(dt: number, _night: number) {
    const c = this.sim.controls;
    const eff = this.sim.autopilot.effectiveControls(c);
    this.yoke.position.x = 14.55 - eff.pitch * 0.08;
    this.yoke.rotation.x = eff.roll * 1.1;
    for (const t of this.thrustLevers) t.rotation.y = -0.6 + c.throttle * 1.0;
    this.timer += dt;
    if (this.timer > 1 / 25) { this.timer = 0; this.draw(); }
  }

  // ---------------------------------------------------------------- drawing
  private txt(s: string, x: number, y: number, size: number, col = '#fff', align: CanvasTextAlign = 'center') {
    const g = this.g;
    g.fillStyle = col; g.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
  }

  draw() {
    const g = this.g, sim = this.sim, ind = sim.systems.ind, ac = sim.aircraft, ap = sim.autopilot, c = sim.controls;
    g.fillStyle = '#23272d'; g.fillRect(0, 0, CW, CH);
    const powered = sim.systems.busPowered();
    // ---- MCP
    const [mx, my, mw, mh] = this.L.mcp;
    g.fillStyle = '#4a4f57'; g.fillRect(mx, my, mw, mh);
    const win = (x: number, label: string, val: string) => {
      g.fillStyle = '#000'; g.fillRect(mx + x, my + 30, 120, 40);
      this.txt(val, mx + x + 60, my + 50, 26, '#ffb000');
      this.txt(label, mx + x + 60, my + 18, 14, '#ddd');
    };
    win(320, 'HEADING', String(Math.round(c.headingBug) % 360).padStart(3, '0'));
    win(620, 'ALTITUDE', String(Math.round(ap.targetAltFt)));
    win(880, 'VERT SPEED', `${ap.targetVsFpm >= 0 ? '+' : ''}${ap.targetVsFpm}`);
    for (const r of this.regions.filter((q) => q.id.startsWith('mcp-'))) {
      const active = (r.id === 'mcp-hdgsel' && ap.engaged && ap.lateral === 'HDG') || (r.id === 'mcp-althold' && ap.engaged && ap.vertical === 'ALT')
        || (r.id === 'mcp-vs' && ap.engaged && ap.vertical === 'VS') || (r.id === 'mcp-cmda' && ap.engaged);
      if (r.id.endsWith('knob') || r.id.endsWith('wheel')) {
        g.fillStyle = '#222'; g.beginPath(); g.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = this.hover === r ? '#5d636c' : '#3a3e44'; g.fillRect(r.x, r.y, r.w, r.h);
        this.txt(r.tip.split(' (')[0].replace('CMD A', 'CMD A'), r.x + r.w / 2, r.y + r.h / 2 - 6, 15, '#eee');
        g.fillStyle = active ? '#3cff6a' : '#203020'; g.fillRect(r.x + 10, r.y + r.h - 12, r.w - 20, 6);
      }
    }
    this.txt('A/T  LNAV  VNAV  APP: not implemented', mx + 160, my + 100, 13, '#aab', 'center');
    if (!powered) return this.finish();
    this.drawPFD(...(this.L.pfd as [number, number, number, number]));
    this.drawND(...(this.L.nd as [number, number, number, number]));
    this.drawEngines(...(this.L.eng as [number, number, number, number]));
    // gear lever, flap lever, speedbrake
    const gearR = this.regions.find((q) => q.id === 'gear')!;
    g.fillStyle = '#111'; g.fillRect(gearR.x, gearR.y, gearR.w, gearR.h);
    g.fillStyle = '#ddd'; g.beginPath(); g.arc(gearR.x + gearR.w / 2, c.gearDown ? gearR.y + gearR.h - 40 : gearR.y + 40, 26, 0, Math.PI * 2); g.fill();
    this.txt(c.gearDown ? 'DN' : 'UP', gearR.x + gearR.w / 2, gearR.y + gearR.h / 2, 22, '#fff');
    this.txt('GEAR', gearR.x + gearR.w / 2, gearR.y - 14, 15, '#ccc');
    const flR = this.regions.find((q) => q.id === 'flaps')!;
    g.fillStyle = '#111'; g.fillRect(flR.x, flR.y, flR.w, flR.h);
    const det = ['0', '1', '2', '5', '10', '15', '25', '30', '40'];
    det.forEach((d, i) => this.txt(d, flR.x + flR.w - 18, flR.y + 14 + i * 24, 13, i === c.flapLever ? '#fff' : '#888'));
    g.fillStyle = '#ddd'; g.fillRect(flR.x + 10, flR.y + 4 + c.flapLever * 24, 60, 18);
    this.txt('FLAPS', flR.x + flR.w / 2, flR.y - 14, 15, '#ccc');
    const sbR = this.regions.find((q) => q.id === 'sbrake')!;
    g.fillStyle = '#111'; g.fillRect(sbR.x, sbR.y, sbR.w, sbR.h);
    g.fillStyle = '#ddd'; g.fillRect(sbR.x + 20, sbR.y + 10 + c.speedbrake * (sbR.h - 40), sbR.w - 40, 20);
    this.txt('SPEED BRAKE', sbR.x + sbR.w / 2, sbR.y - 14, 15, '#ccc');
    const pb = this.regions.find((q) => q.id === 'pbrake')!;
    g.fillStyle = c.parkingBrake ? '#c0392b' : '#333'; g.fillRect(pb.x, pb.y, pb.w, pb.h);
    this.txt(c.parkingBrake ? 'PARK BRAKE SET' : 'PARK BRAKE', pb.x + pb.w / 2, pb.y + pb.h / 2, 16, '#fff');
    if (ind.stallHorn) this.txt('STALL - STICK SHAKER', 400, 800, 26, '#ff3030');
    void ac;
    this.finish();
  }

  private finish() { this.tex.needsUpdate = true; }

  private drawPFD(x: number, y: number, w: number, h: number) {
    const g = this.g, ind = this.sim.systems.ind, ap = this.sim.autopilot;
    g.fillStyle = '#000'; g.fillRect(x, y, w, h);
    const cx = x + w * 0.5, cy = y + h * 0.48, r = w * 0.27;
    // attitude
    g.save(); g.beginPath(); g.rect(cx - r, cy - r * 1.05, 2 * r, 2.1 * r); g.clip();
    g.translate(cx, cy); g.rotate((-ind.rollDeg * Math.PI) / 180);
    const ppd = r / 20;
    const off = ind.pitchDeg * ppd;
    g.fillStyle = '#2b78c5'; g.fillRect(-3 * r, -6 * r + off, 6 * r, 6 * r);
    g.fillStyle = '#8a5426'; g.fillRect(-3 * r, off, 6 * r, 6 * r);
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-3 * r, off); g.lineTo(3 * r, off); g.stroke();
    for (let p = -30; p <= 30; p += 2.5) {
      if (p === 0) continue;
      const yy = off - p * ppd;
      const ww = p % 10 === 0 ? r * 0.5 : p % 5 === 0 ? r * 0.25 : r * 0.12;
      g.beginPath(); g.moveTo(-ww / 2, yy); g.lineTo(ww / 2, yy); g.stroke();
      if (p % 10 === 0) this.txt(String(Math.abs(p)), -ww / 2 - 18, yy, 14);
    }
    g.restore();
    // aircraft symbol
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.fillStyle = '#000';
    for (const s of [-1, 1]) { g.strokeRect(cx + s * r * 0.55 - (s > 0 ? 0 : r * 0.3), cy - 4, r * 0.3, 8); }
    g.strokeRect(cx - 5, cy - 5, 10, 10);
    // speed tape (left)
    const tapeH = h * 0.62, ty = cy - tapeH / 2;
    const tape = (tx: number, val: number, step: number, pxPer: number, fmt: (v: number) => string, right: boolean) => {
      g.fillStyle = '#3d4249'; g.fillRect(tx, ty, 70, tapeH);
      g.save(); g.beginPath(); g.rect(tx, ty, 70, tapeH); g.clip();
      const base = Math.floor(val / step) * step;
      for (let k = -10; k <= 10; k++) {
        const v = base + k * step;
        const yy = cy - (v - val) * pxPer;
        g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(right ? tx : tx + 70, yy); g.lineTo(right ? tx + 12 : tx + 58, yy); g.stroke();
        if (v % (step * 2) === 0 && v >= 0) this.txt(fmt(v), tx + 35 + (right ? 8 : -6), yy, 16);
      }
      g.restore();
      g.fillStyle = '#000'; g.fillRect(tx - 4, cy - 18, 78, 36);
      g.strokeStyle = '#fff'; g.strokeRect(tx - 4, cy - 18, 78, 36);
      this.txt(fmt(Math.round(val)), tx + 35, cy, 22);
    };
    tape(x + 12, ind.iasKt, 10, 4, (v) => String(v), false);
    tape(x + w - 110, ind.altitudeFt, 100, 0.4, (v) => String(v), true);
    // vertical speed
    const vsX = x + w - 30;
    g.fillStyle = '#3d4249'; g.fillRect(vsX, ty, 22, tapeH);
    const vsPx = Math.max(-1, Math.min(1, ind.vsiFpm / 4000)) * tapeH * 0.45;
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(vsX + 2, cy); g.lineTo(vsX + 20, cy - vsPx); g.stroke();
    if (Math.abs(ind.vsiFpm) > 400) this.txt(String(Math.round(ind.vsiFpm / 50) * 50), vsX + 10, ind.vsiFpm > 0 ? ty - 12 : ty + tapeH + 12, 14);
    // heading strip
    const hy = y + h - 50;
    g.fillStyle = '#3d4249'; g.fillRect(cx - r, hy, 2 * r, 40);
    for (let d = -30; d <= 30; d += 5) {
      const hd = Math.round(ind.headingDeg / 5) * 5 + d;
      const xx = cx + (hd - ind.headingDeg) * (r / 30);
      if (xx < cx - r || xx > cx + r) continue;
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(xx, hy); g.lineTo(xx, hy + (hd % 10 === 0 ? 14 : 8)); g.stroke();
      if (hd % 10 === 0) this.txt(String(((hd % 360) + 360) % 360 / 10 | 0), xx, hy + 26, 14);
    }
    this.txt(String(Math.round(ind.headingDeg) % 360).padStart(3, '0'), cx, hy - 14, 18, '#fff');
    // FMA
    g.fillStyle = '#111'; g.fillRect(x, y, w, 34);
    this.txt(ap.engaged ? (ap.lateral === 'HDG' ? 'HDG SEL' : 'ROLL') : '', x + w * 0.4, y + 17, 18, '#3cff6a');
    this.txt(ap.engaged ? (ap.vertical === 'ALT' ? 'ALT HOLD' : 'V/S') : '', x + w * 0.7, y + 17, 18, '#3cff6a');
    this.txt(ap.engaged ? 'CMD' : (ap.disconnectReason ? 'AP DISC' : ''), x + w * 0.5, y + 56, 18, ap.engaged ? '#3cff6a' : '#ffb000');
    // baro
    this.txt(`QNH ${Math.round(this.sim.controls.kollsman)}`, x + w - 75, y + h - 14, 14, '#3cff6a');
  }

  private drawND(x: number, y: number, w: number, h: number) {
    const g = this.g, ind = this.sim.systems.ind, ac = this.sim.aircraft;
    g.fillStyle = '#000'; g.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h * 0.82, R = h * 0.7;
    const rangeNm = 10;
    const hdg = ind.headingDeg;
    // compass arc
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
    for (let d = 0; d < 360; d += 5) {
      const a = ((d - hdg) * Math.PI) / 180;
      if (Math.abs(((d - hdg + 540) % 360) - 180) > 55) continue;
      const x1 = cx + Math.sin(a) * R, y1 = cy - Math.cos(a) * R;
      const l = d % 10 === 0 ? 14 : 7;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(cx + Math.sin(a) * (R - l), cy - Math.cos(a) * (R - l)); g.stroke();
      if (d % 30 === 0) this.txt(String(d / 10), cx + Math.sin(a) * (R - 28), cy - Math.cos(a) * (R - 28), 15);
    }
    g.setLineDash([6, 6]); g.beginPath(); g.arc(cx, cy, R / 2, Math.PI * 1.17, Math.PI * 1.83); g.stroke(); g.setLineDash([]);
    this.txt(`${rangeNm / 2}`, cx - R / 2 * 0.55, cy - R / 2 * 0.85, 13, '#ccc');
    // heading bug
    const ba = ((this.sim.controls.headingBug - hdg) * Math.PI) / 180;
    g.fillStyle = '#ff40ff'; g.beginPath(); g.arc(cx + Math.sin(ba) * R, cy - Math.cos(ba) * R, 7, 0, Math.PI * 2); g.fill();
    // runways of the airport, positioned relative to the aircraft (true geometry)
    const pxPerM = R / (rangeNm * 1852);
    const toScreen = (e: number, n: number): [number, number] => {
      const de = e - ac.pos.y, dn = n - ac.pos.x;
      const t = (-(hdg + 1.0) * Math.PI) / 180; // magnetic -> true (var ~1 W)
      const xr = de * Math.cos(t) + dn * Math.sin(t), yr = -de * Math.sin(t) + dn * Math.cos(t);
      return [cx + xr * pxPerM, cy - yr * pxPerM];
    };
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    for (const rw of this.airport.runways) {
      const a = toScreen(rw.ends[0].x, rw.ends[0].y), b = toScreen(rw.ends[1].x, rw.ends[1].y);
      g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    }
    const ap = toScreen(0, 0);
    this.txt('EGPH', ap[0] + 26, ap[1] - 12, 14, '#3cf');
    g.restore();
    // own aircraft
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx - 10, cy + 10); g.moveTo(cx, cy - 18); g.lineTo(cx + 10, cy + 10); g.stroke();
    // ground speed, TAS, wind
    const gs = Math.hypot(ac.vel.x, ac.vel.y) / 0.5144;
    this.txt(`GS ${gs.toFixed(0)}  TAS ${(ac.tas / 0.5144).toFixed(0)}`, x + 100, y + 22, 16, '#fff');
    const wv = this.sim.wind.windAt(Math.max(ac.agl, 0));
    const wDir = ((Math.atan2(-wv.y, -wv.x) * 180) / Math.PI + 360) % 360;
    this.txt(`${wDir.toFixed(0).padStart(3, '0')}° / ${(Math.hypot(wv.x, wv.y) / 0.5144).toFixed(0)}`, x + 80, y + 46, 15, '#fff');
    this.txt(`HDG ${Math.round(hdg).toString().padStart(3, '0')} MAG`, cx, y + 22, 18, '#3cff6a');
  }

  private drawEngines(x: number, y: number, w: number, h: number) {
    const g = this.g, ind = this.sim.systems.ind, ac = this.sim.aircraft;
    g.fillStyle = '#000'; g.fillRect(x, y, w, h);
    const dial = (dx: number, dy: number, val: number, max: number, label: string, fmt: string, red: number) => {
      const r = 58;
      g.strokeStyle = '#fff'; g.lineWidth = 3;
      g.beginPath(); g.arc(dx, dy, r, Math.PI, Math.PI * 2.2); g.stroke();
      const a = Math.PI + (Math.min(val, max) / max) * Math.PI * 1.2;
      g.fillStyle = val > red ? '#ff3030' : '#fff';
      g.beginPath(); g.moveTo(dx, dy); g.arc(dx, dy, r - 4, Math.PI, a); g.closePath(); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx + Math.cos(a) * r, dy + Math.sin(a) * r); g.stroke();
      g.fillStyle = '#000'; g.fillRect(dx - 8, dy - 34, 70, 28); g.strokeRect(dx - 8, dy - 34, 70, 28);
      this.txt(fmt, dx + 27, dy - 20, 18);
      this.txt(label, dx, dy + 26, 14, '#3cf');
    };
    ind.n1.forEach((n1, i) => dial(x + 110 + i * 200, y + 100, n1, 110, 'N1', n1.toFixed(1), 101));
    ind.egtC.forEach((egt, i) => dial(x + 110 + i * 200, y + 250, egt, 1000, 'EGT', egt.toFixed(0), 950));
    this.txt(`FF ${(ind.fuelFlowKgH / 1000).toFixed(2)} T/H   FUEL ${(ind.fuelTotalKg / 1000).toFixed(1)} T`, x + w / 2, y + 340, 17);
    // gear and flaps
    const gearCol = ac.gearExt > 0.99 ? '#3cff6a' : ac.gearExt > 0.01 ? '#ff3030' : '#555';
    ['L', 'N', 'R'].forEach((_s, i) => { g.fillStyle = gearCol; g.fillRect(x + 60 + i * 110, y + 380, 90, 34); this.txt(ac.gearExt > 0.01 ? 'DOWN' : 'UP', x + 105 + i * 110, y + 397, 16, '#000'); });
    this.txt(`FLAPS ${Math.round((ac.flap * 180) / Math.PI)}`, x + w / 2, y + 450, 20, '#3cff6a');
    if (ac.spoiler > 0.05) this.txt('SPEED BRAKE EXTENDED', x + w / 2, y + 485, 16, '#ffb000');
    if (ac.engines.some((e) => (e as { reverserDeployed?: number }).reverserDeployed! > 0.1)) this.txt('REV', x + w / 2, y + 30, 20, '#3cff6a');
  }
}
