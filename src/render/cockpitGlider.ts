// Original ASK-21-style two-seat glider front cockpit (no third-party assets), in the glider body frame
// (x forward, y right, z down, metres; the pilot's eye is at (0.8, 0, -0.42)).
// Instruments (airspeed, altimeter, variometer, compass, slip ball) are driven by the simulation; the control
// stick, rudder pedals and airbrake handle move with the controls.

import * as THREE from 'three';
import type { Simulation } from '../sim/simulation';

const mat = (c: number, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, side: THREE.DoubleSide });

function dialTexture(kind: 'asi' | 'alt' | 'vario' | 'compass') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0b0c0d'; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  g.strokeStyle = '#e6e8ea'; g.fillStyle = '#e6e8ea'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const tick = (a: number, r0: number, r1: number, w = 3) => { g.lineWidth = w; g.beginPath(); g.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); g.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1); g.stroke(); };
  const num = (s: string, a: number, r: number, px = 22) => { g.font = `700 ${px}px Arial`; g.fillText(s, Math.sin(a) * r, -Math.cos(a) * r); };
  if (kind === 'asi') {
    // 0-150 kt over 300 degrees; white arc (flap range), green arc (normal), yellow (caution), red line at Vne
    const A = (kt: number) => ((kt / 150) * 300 - 150) * Math.PI / 180;
    const arc = (k0: number, k1: number, col: string) => { g.strokeStyle = col; g.lineWidth = 9; g.beginPath(); g.arc(0, 0, 112, A(k0) - Math.PI / 2, A(k1) - Math.PI / 2); g.stroke(); };
    arc(35, 80, '#e8e8e8'); arc(40, 108, '#2fbf5b'); arc(108, 135, '#f0c020');
    g.strokeStyle = '#e6e8ea';
    for (let k = 0; k <= 150; k += 10) { tick(A(k), 96, 108, k % 50 === 0 ? 4 : 2); if (k % 20 === 0) num(String(k), A(k), 78, 20); }
    tick(A(135), 90, 118, 6); g.fillStyle = '#e03030'; g.fillRect(-1, -1, 0, 0);
    num('KT', 0, 38, 20); num('ASI', 0, -48 + 98, 14);
  } else if (kind === 'alt') {
    const A = (v: number) => (v / 10) * 2 * Math.PI;
    for (let v = 0; v < 10; v += 0.2) tick(A(v), 98, 110, Number.isInteger(v) ? 4 : 2);
    for (let v = 0; v < 10; v++) num(String(v), A(v), 78, 26);
    num('FT x100', 0, -46 + 94, 14); num('ALT', 0, 36, 18);
  } else if (kind === 'vario') {
    // +-5 m/s over +-135 degrees
    const A = (v: number) => (v / 5) * (135 * Math.PI / 180);
    for (let v = -5; v <= 5; v += 0.5) tick(A(v), 98, 110, Number.isInteger(v) ? 4 : 2);
    for (let v = -5; v <= 5; v++) if (v) num(String(Math.abs(v)), A(v), 78, 22);
    g.fillStyle = '#2fbf5b'; num('UP', A(0) + 0.0, -60, 16); g.fillStyle = '#e6e8ea'; num('m/s', 0, 36, 16);
  } else {
    g.fillStyle = '#16181a'; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.fill();
    for (let d = 0; d < 360; d += 10) tick((d * Math.PI) / 180, 96, d % 30 === 0 ? 110 : 104, d % 90 === 0 ? 4 : 2);
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([s, d]) => num(s as string, ((d as number) * Math.PI) / 180, 78, 28));
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export class GliderCockpit {
  readonly root = new THREE.Group();
  private stick = new THREE.Group();
  private brake = new THREE.Group();
  private pedals: THREE.Group[] = [];
  private needles: Record<string, THREE.Group> = {};
  private ball!: THREE.Mesh;
  private compass!: THREE.Mesh;

  constructor(private sim?: Simulation) {
    const R = this.root;
    const white = mat(0xdfe2e4, 0.55), grey = mat(0x6b7077, 0.8), black = mat(0x0f1012, 0.9), seat = mat(0x2d2f33, 1), trim = mat(0x1a1b1d, 0.9);
    const box = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, p: THREE.Object3D = R) => { const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m); b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); p.add(b); return b; };
    const rod = (m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, p: THREE.Object3D = R) => { const len = a.distanceTo(b), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m); c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); p.add(c); return c; };
    // ---- fuselage shell: floor, sides (curved below the canopy rail), rear bulkhead, front bulkhead behind the panel
    box(grey, 0.0, 1.62, -0.33, 0.33, 0.3, 0.34);
    for (const s of [-1, 1]) {
      box(white, 0.0, 1.62, s * 0.33 - 0.015, s * 0.33 + 0.015, -0.12, 0.34);                 // side wall below the canopy rail
      box(white, 0.0, 1.62, s * 0.36 - 0.02, s * 0.36 + 0.02, -0.16, -0.1);                  // canopy sill / rail
      box(grey, 0.15, 1.35, s * 0.31, s * 0.33, 0.05, 0.2);                                  // side console
    }
    box(white, -0.02, 0.0, -0.36, 0.36, -0.2, 0.34);                                        // bulkhead behind the seat
    box(black, 1.5, 1.62, -0.35, 0.35, -0.5, 0.34);                                         // front bulkhead
    // ---- glare shield / coaming over the panel
    box(trim, 1.4, 1.62, -0.34, 0.34, -0.5, -0.46);
    // ---- instrument panel (slightly tilted) with the dials
    const panel = new THREE.Group(); panel.position.set(1.46, 0, -0.33); panel.rotation.y = 0.2; R.add(panel);
    const pm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.62, 0.3), mat(0x16181a, 0.9)); panel.add(pm);
    const dials: [string, number, number, number][] = [['asi', -0.16, -0.085, 0.062], ['alt', 0.16, -0.085, 0.062], ['vario', -0.16, 0.055, 0.052], ['compass', 0.16, 0.055, 0.052]];
    const kinds: Record<string, 'asi' | 'alt' | 'vario' | 'compass'> = { asi: 'asi', alt: 'alt', vario: 'vario', compass: 'compass' };
    for (const [k, y, z, r] of dials) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ map: dialTexture(kinds[k]) }));
      face.rotation.y = -Math.PI / 2; face.position.set(-0.0105, y, z); panel.add(face);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.006, 8, 40), mat(0x8a8f95, 0.4, 0.6)); bezel.rotation.y = Math.PI / 2; bezel.position.set(-0.011, y, z); panel.add(bezel);
      if (k === 'compass') { this.compass = face; continue; }
      const nd = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, r * 0.85), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
      nd.geometry.translate(0, 0, -r * 0.4); // pivot at the dial centre, needle points "up" (-z)
      const g = new THREE.Group(); g.position.set(-0.0125, y, z); g.add(nd); panel.add(g); this.needles[k] = g;
    }
    // slip ball (tell-tale) below the dials
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 12), mat(0x222428, 0.3)); tube.rotation.x = Math.PI / 2; tube.position.set(-0.012, 0, 0.125); panel.add(tube);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 })); this.ball.position.set(-0.016, 0, 0.125); panel.add(this.ball);
    // yellow cable-release knob and the red canopy jettison handle
    const rel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), mat(0xe8c020, 0.5)); rel.position.set(1.44, -0.27, -0.2); R.add(rel);
    rod(mat(0xe8c020, 0.5), new THREE.Vector3(1.45, -0.27, -0.21), new THREE.Vector3(1.47, -0.27, -0.22), 0.006);
    const jet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), mat(0xc02820, 0.5)); jet.position.set(1.44, 0.27, -0.2); R.add(jet);
    // ---- canopy frame: front bow, two side rails and a hoop behind the pilot
    const hoop = (x: number) => { for (let i = 0; i < 12; i++) { const a0 = (i / 12) * Math.PI, a1 = ((i + 1) / 12) * Math.PI; rod(trim, new THREE.Vector3(x, -Math.cos(a0) * 0.38, -0.12 - Math.sin(a0) * 0.5), new THREE.Vector3(x, -Math.cos(a1) * 0.38, -0.12 - Math.sin(a1) * 0.5), 0.012); } };
    hoop(1.42); hoop(0.5);
    for (const s of [-1, 1]) rod(trim, new THREE.Vector3(1.42, s * 0.38, -0.12), new THREE.Vector3(0.5, s * 0.38, -0.12), 0.014);
    rod(trim, new THREE.Vector3(1.42, 0, -0.62), new THREE.Vector3(0.5, 0, -0.62), 0.012);
    // ---- seat with head rest and harness
    box(seat, 0.18, 0.62, -0.2, 0.2, 0.2, 0.28); box(seat, 0.0, 0.14, -0.2, 0.2, -0.3, 0.26); box(seat, 0.0, 0.1, -0.1, 0.1, -0.42, -0.3);
    for (const s of [-1, 1]) rod(mat(0x2a3a5a, 0.9), new THREE.Vector3(0.08, s * 0.1, -0.28), new THREE.Vector3(0.4, s * 0.08, 0.2), 0.012);
    // ---- control stick with grip and trigger
    this.stick.position.set(0.95, 0, 0.3); R.add(this.stick);
    rod(black, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.42), 0.014, this.stick);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.12, 12), mat(0x111214, 0.8)); grip.position.set(0, 0, -0.46); grip.rotation.x = 0.1; this.stick.add(grip);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.03), mat(0xcfd3d6, 0.5)); trig.position.set(0.02, 0, -0.44); this.stick.add(trig);
    // ---- airbrake handle (blue) on the left console, trim lever (green), undercarriage / flap handles
    this.brake.position.set(0.7, -0.29, 0.1); R.add(this.brake);
    rod(grey, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.0, 0, -0.17), 0.009, this.brake);
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 12), mat(0x2f62c8, 0.5)); bk.rotation.x = Math.PI / 2; bk.position.set(0, 0, -0.2); bk.rotation.z = Math.PI / 2; this.brake.add(bk);
    box(mat(0x20a050, 0.5), 0.62, 0.7, -0.3, -0.27, 0.1, 0.13);
    box(mat(0xd0d3d6, 0.5), 0.5, 0.56, -0.3, -0.27, 0.1, 0.12);
    // ---- rudder pedals on a bar in the footwell
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(1.25, s * 0.11, 0.2); R.add(p);
      box(mat(0x2a2c30, 0.8), -0.02, 0.02, -0.07, 0.07, -0.09, 0.09, p);
      rod(grey, new THREE.Vector3(0, 0, 0.09), new THREE.Vector3(-0.22, 0, 0.26), 0.01, p);
      this.pedals.push(p);
    }
    R.traverse((o) => { o.frustumCulled = false; });
    this.root.visible = false;
  }

  update(dt: number, _night: number) {
    const sim = this.sim; if (!sim) return;
    const c = sim.controls, ind = sim.systems.ind;
    void dt;
    this.stick.rotation.y = 0.32 * c.pitch;
    this.stick.rotation.x = 0.4 * c.roll;
    this.brake.rotation.y = 0.9 * c.speedbrake;
    this.pedals[0].position.x = 1.25 + 0.04 * c.yaw; this.pedals[1].position.x = 1.25 - 0.04 * c.yaw;
    const set = (k: string, ang: number) => { this.needles[k].rotation.x = ang; };
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    // dials: the panel faces aft; rotation about the panel normal (x axis); needle "up" is -z
    set('asi', ((clamp(ind.iasKt, 0, 150) / 150) * 300 - 150) * Math.PI / 180 * -1);
    set('alt', ((ind.altitudeFt % 1000) / 1000) * 2 * Math.PI * -1);
    set('vario', clamp(ind.vsiFpm / 196.85, -5, 5) / 5 * (135 * Math.PI / 180) * -1);
    this.ball.position.y = clamp(ind.slipBall, -1, 1) * 0.06;
    this.compass.rotation.z = (ind.compassDeg * Math.PI) / 180;
  }
}
