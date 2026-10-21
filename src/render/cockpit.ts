// C172 cockpit: 3D interior (authored in the body frame) with a live instrument panel
// and mouse-operable switches, knobs, levers and autopilot buttons. All switches change
// FlightControls / Autopilot state that the simulation actually uses.

import * as THREE from 'three';
import { Simulation } from '../sim/simulation';
import { MagSwitch } from '../sim/fdm/piston';
import { FuelSelector, FlightControls } from '../sim/controls';
import {
  drawASI, drawAI, drawALT, drawTC, drawHI, drawVSI, drawTach, drawMini, drawAnnunciator, label, drawBezel,
} from '../instruments/gauges';

const PX_PER_M = 1600;
const PANEL_W = 1.5, PANEL_H = 0.55;
const CW = PANEL_W * PX_PER_M, CH = PANEL_H * PX_PER_M; // 2400 x 880
const PANEL_X = 0.85; // body x of the panel face
const PANEL_TOP_UP = 0.6; // height of the panel top above the datum

/** Pilot's design eye point in the body frame (FRD). */
export const EYE = new THREE.Vector3(0.18, -0.3, -0.8);

export interface Region {
  id: string;
  x: number; y: number; w: number; h: number;
  tip: string;
  /** dir: -1 left half / wheel down, +1 right half / wheel up */
  act: (dir: number, phase: 'down' | 'up' | 'wheel') => void;
}

const MAGS: MagSwitch[] = ['OFF', 'R', 'L', 'BOTH', 'START'];
const FUEL: FuelSelector[] = ['LEFT', 'BOTH', 'RIGHT', 'OFF'];

export class Cockpit {
  readonly root = new THREE.Group();
  readonly panelMesh: THREE.Mesh;
  readonly knobs: THREE.Mesh[] = [];
  regions: Region[] = [];
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private yoke = new THREE.Group();
  private yokeHorns = new THREE.Group();
  private throttle!: THREE.Mesh;
  private mixture!: THREE.Mesh;
  private pedals: THREE.Object3D[] = [];
  private trimWheel!: THREE.Mesh;
  private redrawTimer = 0;
  hover: Region | null = null;
  private pressed: Region | null = null;

  constructor(private sim: Simulation) {
    this.root.name = 'cockpit';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW; this.canvas.height = CH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const panelMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0 });
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), panelMat);
    // plane local X -> body +y, local Y -> body up (-z), normal -> body -x (toward pilot)
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
    this.panelMesh.applyMatrix4(m);
    this.panelMesh.position.set(PANEL_X - 0.001, 0, -(PANEL_TOP_UP - PANEL_H / 2));
    this.panelMesh.name = 'panel';
    this.root.add(this.panelMesh);
    this.buildInterior();
    this.buildRegions();
    this.draw();
  }

  // ------------------------------------------------------------------ interior
  private buildInterior() {
    const plastic = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.9 });
    const lining = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.7 });
    const carpet = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 1 });
    const box = (x0: number, x1: number, y0: number, y1: number, u0: number, u1: number, mat: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, u1 - u0), mat);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, -(u0 + u1) / 2);
      b.receiveShadow = true;
      this.root.add(b);
      return b;
    };
    box(PANEL_X, PANEL_X + 0.06, -0.75, 0.75, PANEL_TOP_UP - PANEL_H, PANEL_TOP_UP, dark); // panel backing
    box(0.8, 1.0, -0.62, 0.62, PANEL_TOP_UP, PANEL_TOP_UP + 0.035, plastic); // glareshield
    box(0.78, 0.84, -0.62, 0.62, PANEL_TOP_UP - 0.02, PANEL_TOP_UP + 0.05, plastic); // glareshield lip
    box(PANEL_X, 1.25, -0.6, 0.6, -0.25, PANEL_TOP_UP - PANEL_H, plastic); // lower panel / firewall
    box(-1.3, 1.25, -0.6, 0.6, -0.3, -0.25, carpet); // floor
    for (const s of [-1, 1]) {
      box(-1.3, 1.1, s * 0.6 - 0.02, s * 0.6 + 0.02, -0.25, 0.53, lining); // side walls below the windows
      box(0.3, 0.8, s * 0.585 - 0.01, s * 0.585 + 0.01, 0.15, 0.3, plastic); // arm rest
    }
    box(-1.3, 0.95, -0.6, 0.6, 0.97, 1.0, lining); // headliner
    box(-1.3, -1.25, -0.6, 0.6, -0.25, 1.0, lining); // rear bulkhead
    // window posts
    const post = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, len), plastic);
      p.position.copy(a).add(b).multiplyScalar(0.5);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
      this.root.add(p);
    };
    for (const s of [-1, 1]) {
      post(new THREE.Vector3(1.2, s * 0.56, -0.66), new THREE.Vector3(0.72, s * 0.58, -0.98)); // A pillar
      post(new THREE.Vector3(-0.38, s * 0.6, -0.53), new THREE.Vector3(-0.38, s * 0.6, -0.98)); // door post
      post(new THREE.Vector3(1.05, s * 0.6, -0.53), new THREE.Vector3(-1.2, s * 0.6, -0.53)); // window sill
    }
    post(new THREE.Vector3(1.1, 0, -0.68), new THREE.Vector3(0.74, 0, -0.97)); // centre strip
    // seats
    for (const s of [-1, 1]) {
      box(-0.35, 0.15, s * 0.3 - 0.24, s * 0.3 + 0.24, -0.12, 0.02, leather);
      const back = box(-0.48, -0.36, s * 0.3 - 0.24, s * 0.3 + 0.24, 0.02, 0.72, leather);
      back.rotation.y = 0.2;
      box(-1.1, -0.6, s * 0.3 - 0.26, s * 0.3 + 0.26, -0.12, 0.02, leather);
    }
    // yokes
    const yokeMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.5 });
    for (const s of [-1, 1]) {
      const g = s < 0 ? this.yoke : new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.3 }));
      shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.15;
      g.add(shaft);
      const horns = s < 0 ? this.yokeHorns : new THREE.Group();
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.06), yokeMat);
      horns.add(hub);
      for (const k of [-1, 1]) {
        // ram's-horn grip: out from the hub, then curving upward (body frame: up = -z)
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, k * 0.04, 0), new THREE.Vector3(-0.01, k * 0.1, 0.01),
          new THREE.Vector3(-0.015, k * 0.14, -0.02), new THREE.Vector3(-0.015, k * 0.15, -0.08),
        ]);
        horns.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 8, false), yokeMat));
      }
      g.add(horns);
      g.position.set(0.66, s * 0.3, -0.32);
      this.root.add(g);
      if (s > 0) this.copilotYoke = g;
    }
    // throttle and mixture knobs (draggable)
    const knob = (y: number, color: number, name: string) => {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      k.rotation.z = Math.PI / 2;
      k.position.set(0.8, y, -0.17);
      k.name = name;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 }));
      rod.position.y = -0.06; k.add(rod);
      this.root.add(k);
      this.knobs.push(k);
      return k;
    };
    this.throttle = knob(0.0, 0x111111, 'throttle');
    this.mixture = knob(0.1, 0xb01515, 'mixture');
    // rudder pedals
    for (const s of [-1, 1]) for (const p of [-1, 1]) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.16), yokeMat);
      ped.position.set(1.0, s * 0.3 + p * 0.1, 0.08);
      ped.userData.side = p;
      this.root.add(ped);
      this.pedals.push(ped);
    }
    // elevator trim wheel between the seats
    this.trimWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 24), yokeMat);
    this.trimWheel.position.set(0.35, 0, 0.12);
    this.root.add(this.trimWheel);
  }

  private copilotYoke: THREE.Object3D | null = null;

  // ------------------------------------------------------------------ layout
  private L = {
    asi: [560, 250], ai: [720, 250], alt: [880, 250], tc: [560, 420], hi: [720, 420], vsi: [880, 420],
    tach: [1050, 420], clock: [1050, 250], r: 66,
  };

  private buildRegions() {
    const sim = this.sim;
    const c = () => sim.controls;
    const R = (id: string, x: number, y: number, w: number, h: number, tip: string, act: Region['act']) => this.regions.push({ id, x, y, w, h, tip, act });
    const toggle = (key: keyof FlightControls) => (_d: number, ph: string) => { if (ph === 'down') (c() as any)[key] = !(c() as any)[key]; };
    const sw = [
      ['masterBattery', 'BAT'], ['masterAlternator', 'ALT'], ['avionics', 'AVN'], ['fuelPump', 'F PUMP'], ['beacon', 'BCN'],
      ['landingLight', 'LAND'], ['taxiLight', 'TAXI'], ['navLights', 'NAV'], ['strobes', 'STRB'], ['pitotHeat', 'P HEAT'],
    ] as const;
    sw.forEach(([key, name], i) => R(`sw-${key}`, 260 + i * 70, 630, 56, 110, `${name} switch`, toggle(key)));
    R('mags', 110, 620, 120, 120, 'Ignition: click left/right to turn, hold right at BOTH to START', (d, ph) => {
      const i = MAGS.indexOf(c().mags);
      if (ph === 'down') {
        const n = Math.max(0, Math.min(4, i + d));
        c().mags = MAGS[n];
        if (n === 4) this.pressed = this.regions.find((r) => r.id === 'mags')!;
      } else if (ph === 'up' && c().mags === 'START') c().mags = 'BOTH';
    });
    R('kollsman', this.L.alt[0] - 85, this.L.alt[1] + 45, 40, 40, 'Altimeter setting (wheel or click)', (d) => { c().kollsman = Math.round(c().kollsman + d); });
    R('hdgbug', this.L.hi[0] + 45, this.L.hi[1] + 45, 40, 40, 'Heading bug (wheel or click)', (d) => { c().headingBug = (c().headingBug + d * 5 + 360) % 360; });
    R('dgsync', this.L.hi[0] - 85, this.L.hi[1] + 45, 40, 40, 'Heading indicator: align with compass', (_d, ph) => { if (ph === 'down') sim.systems.syncHeadingIndicator(); });
    R('flaps', 1640, 560, 90, 200, 'Flaps: click upper half to retract, lower half to extend', (d, ph) => {
      if (ph === 'down') c().flapLever = Math.max(0, Math.min(3, c().flapLever + d));
    });
    R('fuelsel', 1880, 600, 160, 160, 'Fuel selector: click to cycle LEFT / BOTH / RIGHT / OFF', (d, ph) => {
      if (ph !== 'down') return;
      const i = FUEL.indexOf(c().fuelSelector);
      c().fuelSelector = FUEL[(i + (d > 0 ? 1 : 3)) % 4];
    });
    R('pbrake', 1380, 660, 200, 90, 'Parking brake', toggle('parkingBrake'));
    // autopilot
    const ap = sim.autopilot;
    const apx = 1210, apy = 170;
    R('ap-ap', apx, apy + 70, 60, 40, 'Autopilot engage / disengage', (_d, ph) => { if (ph === 'down') { if (ap.engaged) ap.disengage('Pilot'); else ap.engage(sim.systems); } });
    R('ap-hdg', apx + 70, apy + 70, 60, 40, 'HDG mode', (_d, ph) => { if (ph === 'down' && ap.engaged) ap.lateral = ap.lateral === 'HDG' ? 'ROL' : 'HDG'; });
    R('ap-alt', apx + 140, apy + 70, 60, 40, 'ALT hold', (_d, ph) => {
      if (ph !== 'down' || !ap.engaged) return;
      if (ap.vertical === 'ALT') { ap.vertical = 'VS'; ap.targetVsFpm = 0; } else ap.holdAltitude(sim.systems);
    });
    R('ap-up', apx + 210, apy + 70, 60, 40, 'UP: +100 fpm (VS) / +20 ft (ALT)', (_d, ph) => { if (ph === 'down') { if (ap.vertical === 'VS') ap.targetVsFpm += 100; else ap.targetAltFt += 20; } });
    R('ap-dn', apx + 280, apy + 70, 60, 40, 'DN: -100 fpm (VS) / -20 ft (ALT)', (_d, ph) => { if (ph === 'down') { if (ap.vertical === 'VS') ap.targetVsFpm -= 100; else ap.targetAltFt -= 20; } });
  }

  /** Mouse interaction with panel UV coordinates. Returns the region hit. */
  interact(uv: THREE.Vector2, phase: 'down' | 'up' | 'wheel' | 'move', dir = 0): Region | null {
    const px = uv.x * CW, py = (1 - uv.y) * CH;
    const r = this.regions.find((q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h) ?? null;
    if (phase === 'move') { this.hover = r; return r; }
    if (phase === 'up') { if (this.pressed) { this.pressed.act(0, 'up'); this.pressed = null; } return r; }
    if (!r) return null;
    const d = phase === 'wheel' ? dir : px < r.x + r.w / 2 ? -1 : 1;
    // vertical controls: top half = -1 (retract)
    const dv = r.id === 'flaps' ? (py < r.y + r.h / 2 ? -1 : 1) : d;
    r.act(dv, phase === 'wheel' ? 'wheel' : 'down');
    this.redrawTimer = 1;
    return r;
  }

  releaseAll() { if (this.pressed) { this.pressed.act(0, 'up'); this.pressed = null; } }

  // ------------------------------------------------------------------ per frame
  update(dt: number, night: number) {
    const c = this.sim.controls;
    const ac = this.sim.aircraft;
    const eff = this.sim.autopilot.effectiveControls(c);
    // yoke: fore/aft with pitch, rotate with roll
    for (const y of [this.yoke, this.copilotYoke]) {
      if (!y) continue;
      y.position.x = 0.66 - eff.pitch * 0.07;
      (y === this.yoke ? this.yokeHorns : y.children[1]).rotation.x = eff.roll * 0.8;
    }
    this.throttle.position.x = 0.74 + c.throttle * 0.07;
    this.mixture.position.x = 0.74 + c.mixture * 0.07;
    for (const p of this.pedals) p.position.x = 1.0 + (p.userData.side as number) * c.yaw * 0.04;
    this.trimWheel.rotation.y = c.trim * 3;
    // panel lighting at night
    (this.panelMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = c.masterBattery ? 0.06 + night * 0.35 : 0.02;
    this.redrawTimer += dt;
    if (this.redrawTimer > 1 / 30) { this.redrawTimer = 0; this.draw(); }
    void ac;
  }

  draw() {
    const g = this.g;
    const sim = this.sim;
    const ind = sim.systems.ind;
    const c = sim.controls;
    const ac = sim.aircraft;
    const L = this.L;
    // panel face
    const grd = g.createLinearGradient(0, 0, 0, CH);
    grd.addColorStop(0, '#2b2f35'); grd.addColorStop(1, '#1f2227');
    g.fillStyle = grd; g.fillRect(0, 0, CW, CH);
    g.fillStyle = '#25292e'; g.fillRect(1180, 120, 520, 440); // centre stack plate
    // flight instruments
    drawASI(g, L.asi[0], L.asi[1], L.r, ind.iasKt);
    drawAI(g, L.ai[0], L.ai[1], L.r, ind.pitchDeg, ind.rollDeg);
    drawALT(g, L.alt[0], L.alt[1], L.r, ind.altitudeFt, c.kollsman);
    drawTC(g, L.tc[0], L.tc[1], L.r, ind.turnRateDegS, ind.slipBall, ind.turnFlag);
    drawHI(g, L.hi[0], L.hi[1], L.r, ind.headingDeg, c.headingBug);
    drawVSI(g, L.vsi[0], L.vsi[1], L.r, ind.vsiFpm);
    drawTach(g, L.tach[0], L.tach[1], L.r, ind.rpm, sim.simTime / 3600);
    // knobs drawn on instrument corners
    for (const id of ['kollsman', 'hdgbug', 'dgsync']) {
      const r = this.regions.find((q) => q.id === id)!;
      g.fillStyle = '#111'; g.beginPath(); g.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = this.hover === r ? '#5aa9ff' : '#555'; g.lineWidth = 3; g.stroke();
      label(g, id === 'kollsman' ? 'BARO' : id === 'hdgbug' ? 'HDG' : 'PUSH', r.x + r.w / 2, r.y + r.h / 2, 10, '#aaa');
    }
    // clock / OAT
    drawBezel(g, L.clock[0], L.clock[1], L.r * 0.8);
    const tod = sim.weather.timeOfDay + sim.simTime / 3600;
    const hh = Math.floor(tod) % 24, mm = Math.floor((tod % 1) * 60);
    label(g, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, L.clock[0], L.clock[1] - 10, 30, '#9fe0ff');
    label(g, `OAT ${ind.oatC.toFixed(0)}°C`, L.clock[0], L.clock[1] + 26, 18, '#9fe0ff');
    // engine cluster (left of the six-pack)
    const pow = sim.systems.busPowered();
    const ex = 150, ew = 250, eh = 92;
    drawMini(g, ex, 120, ew / 2 - 5, eh, 'FUEL L', ind.fuelLeftGal, 0, 26, null, [0, 1.5], (v) => `${v.toFixed(0)} GAL`, pow);
    drawMini(g, ex + ew / 2 + 5, 120, ew / 2 - 5, eh, 'FUEL R', ind.fuelRightGal, 0, 26, null, [0, 1.5], (v) => `${v.toFixed(0)} GAL`, pow);
    drawMini(g, ex, 220, ew / 2 - 5, eh, 'OIL T', ind.oilTempF, 75, 250, [100, 245], [245, 250], (v) => `${v.toFixed(0)}°F`, pow);
    drawMini(g, ex + ew / 2 + 5, 220, ew / 2 - 5, eh, 'OIL P', ind.oilPressPsi, 0, 115, [50, 90], [0, 20], (v) => `${v.toFixed(0)} PSI`, pow);
    drawMini(g, ex, 320, ew / 2 - 5, eh, 'EGT', ind.egtF, 900, 1700, null, null, (v) => `${v.toFixed(0)}°F`, pow);
    drawMini(g, ex + ew / 2 + 5, 320, ew / 2 - 5, eh, 'FUEL FLOW', ind.fuelFlowGph, 0, 20, [4, 11], null, (v) => `${v.toFixed(1)} GPH`, pow);
    drawMini(g, ex, 420, ew / 2 - 5, eh, 'VAC', ind.vacuumInHg, 3, 7, [4.5, 5.5], null, (v) => `${v.toFixed(1)} inHg`, true);
    drawMini(g, ex + ew / 2 + 5, 420, ew / 2 - 5, eh, 'AMPS', ind.ammeterA, -60, 60, null, null, (v) => `${v.toFixed(0)} A`, pow);
    // annunciators (powered from the bus)
    drawAnnunciator(g, 1200, 130, 480, 34, [
      ['L FUEL', pow && ind.lowFuelL, '#f1c40f'], ['R FUEL', pow && ind.lowFuelR, '#f1c40f'],
      ['OIL PRESS', pow && ind.lowOilPress, '#e74c3c'], ['LOW VAC', pow && ind.lowVacuum, '#f1c40f'],
      ['VOLTS', pow && ind.lowVolts, '#e74c3c'],
    ]);
    // KAP 140 autopilot
    const ap = sim.autopilot;
    const apx = 1210, apy = 170;
    g.fillStyle = '#0d0f12'; g.fillRect(apx - 10, apy, 360, 120);
    g.fillStyle = '#050505'; g.fillRect(apx, apy + 8, 340, 52);
    const apPow = pow && c.avionics;
    if (apPow) {
      g.fillStyle = '#ffb000';
      g.font = '600 22px monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(ap.engaged ? `${ap.lateral}  ${ap.vertical}` : (ap.disconnectReason ? 'AP DISC' : 'AP OFF'), apx + 10, apy + 24);
      g.fillText(ap.vertical === 'ALT' ? `${ap.targetAltFt.toFixed(0)} FT` : `${ap.targetVsFpm >= 0 ? '+' : ''}${ap.targetVsFpm} FPM`, apx + 10, apy + 48);
      if (ap.engaged) { g.fillText('AP', apx + 290, apy + 24); }
    }
    for (const id of ['ap-ap', 'ap-hdg', 'ap-alt', 'ap-up', 'ap-dn']) {
      const r = this.regions.find((q) => q.id === id)!;
      g.fillStyle = this.hover === r ? '#3b4048' : '#22262c'; g.fillRect(r.x, r.y, r.w, r.h);
      label(g, id.slice(3).toUpperCase(), r.x + r.w / 2, r.y + r.h / 2, 16, '#ddd');
    }
    label(g, 'AUTOPILOT', apx + 170, apy + 132, 14, '#888');
    // switch row
    for (const r of this.regions.filter((q) => q.id.startsWith('sw-'))) {
      const key = r.id.slice(3) as keyof FlightControls;
      const on = Boolean(c[key]);
      const isMaster = key === 'masterBattery' || key === 'masterAlternator';
      g.fillStyle = '#111'; g.fillRect(r.x, r.y, r.w, r.h - 30);
      g.fillStyle = isMaster ? '#b8231b' : '#d8d8d8';
      const ry = on ? r.y + 6 : r.y + (r.h - 30) / 2;
      g.fillRect(r.x + 8, ry, r.w - 16, (r.h - 30) / 2 - 6);
      if (this.hover === r) { g.strokeStyle = '#5aa9ff'; g.lineWidth = 3; g.strokeRect(r.x, r.y, r.w, r.h - 30); }
      label(g, r.tip.replace(' switch', ''), r.x + r.w / 2, r.y + r.h - 14, 15, '#ddd');
    }
    // ignition switch
    const mg = this.regions.find((q) => q.id === 'mags')!;
    const mcx = mg.x + mg.w / 2, mcy = mg.y + mg.h / 2;
    g.fillStyle = '#111'; g.beginPath(); g.arc(mcx, mcy, 48, 0, Math.PI * 2); g.fill();
    const magAng = [-100, -55, -15, 25, 70];
    MAGS.forEach((m, i) => {
      const a = (magAng[i] - 90) * Math.PI / 180;
      label(g, m, mcx + Math.cos(a) * 64, mcy + Math.sin(a) * 64, 13, '#ccc');
    });
    const mi = MAGS.indexOf(c.mags);
    g.save(); g.translate(mcx, mcy); g.rotate(magAng[mi] * Math.PI / 180);
    g.fillStyle = '#b0b4b9'; g.fillRect(-8, -40, 16, 80); g.restore();
    // flap switch and position indicator
    const fl = this.regions.find((q) => q.id === 'flaps')!;
    g.fillStyle = '#111'; g.fillRect(fl.x, fl.y, fl.w, fl.h);
    const detY = (i: number) => fl.y + 20 + (i / 3) * (fl.h - 40);
    ['0°', '10°', '20°', '30°'].forEach((t, i) => label(g, t, fl.x + fl.w + 30, detY(i), 16, '#ccc'));
    g.fillStyle = '#ddd'; g.fillRect(fl.x + 15, detY(c.flapLever) - 10, fl.w - 30, 20);
    const flapDeg = (ac.flap * 180) / Math.PI;
    g.fillStyle = '#f39c12'; g.beginPath(); g.moveTo(fl.x - 4, detY(flapDeg / 10)); g.lineTo(fl.x - 20, detY(flapDeg / 10) - 9); g.lineTo(fl.x - 20, detY(flapDeg / 10) + 9); g.fill();
    label(g, 'FLAPS', fl.x + fl.w / 2, fl.y - 14, 15, '#ddd');
    // fuel selector
    const fs = this.regions.find((q) => q.id === 'fuelsel')!;
    const fcx = fs.x + fs.w / 2, fcy = fs.y + fs.h / 2;
    g.fillStyle = '#c9a227'; g.beginPath(); g.arc(fcx, fcy, 62, 0, Math.PI * 2); g.fill();
    const fAng: Record<FuelSelector, number> = { LEFT: -90, BOTH: 0, RIGHT: 90, OFF: 180 };
    for (const k of FUEL) { const a = (fAng[k] - 90) * Math.PI / 180; label(g, k, fcx + Math.cos(a) * 46, fcy + Math.sin(a) * 46, 13, '#111'); }
    g.save(); g.translate(fcx, fcy); g.rotate(fAng[c.fuelSelector] * Math.PI / 180);
    g.fillStyle = '#222'; g.fillRect(-9, -40, 18, 70); g.beginPath(); g.moveTo(-14, -40); g.lineTo(0, -56); g.lineTo(14, -40); g.fill(); g.restore();
    label(g, 'FUEL SELECTOR', fcx, fs.y - 10, 14, '#ddd');
    // parking brake handle
    const pb = this.regions.find((q) => q.id === 'pbrake')!;
    g.fillStyle = c.parkingBrake ? '#c0392b' : '#333'; g.fillRect(pb.x, pb.y + 20, pb.w, 40);
    label(g, c.parkingBrake ? 'PARK BRAKE SET' : 'PARK BRAKE', pb.x + pb.w / 2, pb.y + 40, 16, '#fff');
    // stall warning / starter
    if (ind.stallHorn) label(g, 'STALL', 1050, 120, 22, '#e74c3c');
    // passenger side: JetVault plate
    g.fillStyle = '#1b1e23'; g.fillRect(1760, 120, 560, 380);
    label(g, 'JETVAULT', 2040, 280, 54, '#d9dee6');
    label(g, 'C172S  ·  STEAM GAUGE', 2040, 330, 18, '#7f8b9a');
    label(g, 'Radios / NAV / transponder not yet modelled', 2040, 450, 16, '#5d6670');
    this.tex.needsUpdate = true;
  }
}
