// Original procedural Boeing 737-800 exterior (no third-party assets). Proportions follow
// the public airport-planning dimensions used in sim/aircraft/b738.ts. Authored in the
// body frame (FRD) with origin at the datum; moving parts are driven by the simulation.

import * as THREE from 'three';
import { B737Rig } from './b737Rig';
import { Aircraft } from '../sim/fdm/aircraft';
import { FlightControls } from '../sim/controls';
import { naca, airfoilPart, loftWing, orient, strut } from './c172Model';
import { b738ChordAt, b738QcX, b738WingZ } from '../sim/aircraft/b738';

const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, vertexColors: true });
const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 });
const grey = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.45, metalness: 0.35 });
const navyMat = new THREE.MeshPhysicalMaterial({ color: 0x14254a, roughness: 0.35, clearcoat: 1 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.4 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.2, metalness: 0.9 });

const NAVY = new THREE.Color(0x14254a), BLUE = new THREE.Color(0x2f6fd6), WHITE = new THREE.Color(0xf4f5f7);
const GLASS = new THREE.Color(0x101820), BELLY = new THREE.Color(0xc9ced6);

// fuselage stations: x, half-width, top z, bottom z (FRD, up = -z)
const FUS: [number, number, number, number][] = [
  [17.75, 0.05, 0.2, 0.5], [17.5, 0.55, -0.3, 1.0], [17.0, 1.0, -0.85, 1.35], [16.2, 1.45, -1.35, 1.65], [15.0, 1.75, -1.72, 1.82],
  [13.6, 1.88, -1.88, 1.88], [-9.5, 1.88, -1.88, 1.88], [-12.5, 1.78, -1.86, 1.55], [-15.5, 1.45, -1.8, 0.95],
  [-18.5, 0.95, -1.68, 0.1], [-20.8, 0.48, -1.52, -0.65], [-21.7, 0.15, -1.42, -1.1],
];
function fus(x: number): [number, number, number] {
  for (let i = 0; i + 1 < FUS.length; i++) {
    const [x0, w0, t0, b0] = FUS[i], [x1, w1, t1, b1] = FUS[i + 1];
    if (x <= x0 && x >= x1) {
      const t = (x0 - x) / (x0 - x1);
      const s = i < 5 ? Math.sin((t * Math.PI) / 2) * 0.5 + t * 0.5 : t;
      return [w0 + (w1 - w0) * s, t0 + (t1 - t0) * s, b0 + (b1 - b0) * s];
    }
  }
  const l = FUS[FUS.length - 1];
  return [l[1], l[2], l[3]];
}

function fuselage() {
  const x0 = FUS[0][0], x1 = FUS[FUS.length - 1][0];
  const nx = 420, nr = 48;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    const [hw, top, bot] = fus(x);
    const zc = (top + bot) / 2, hh = (bot - top) / 2;
    for (let j = 0; j < nr; j++) {
      const th = (j / nr) * Math.PI * 2;
      const y = hw * Math.sin(th), z = zc - hh * Math.cos(th);
      pos.push(x, y, z);
      let c = WHITE;
      const up = -z;
      // cabin windows: 0.5 m pitch along both sides
      const win = x < 12.6 && x > -12.8 && up > 0.45 && up < 0.78 && Math.abs(y) > 1.5 && ((x + 40) % 0.508) < 0.24;
      // flight-deck windows
      const fd = x > 15.15 && x < 16.6 && up > 0.75 + (x - 15.15) * 0.25 && up < 1.32 + (x - 15.15) * 0.12 && Math.abs(y) > 0.12;
      if (win || fd) c = GLASS;
      else if (up < -0.9) c = BELLY;
      else if (up < -0.15 && up > -0.42 && x < 15.5) c = NAVY;
      else if (up < -0.42 && up > -0.55 && x < 15.5) c = BLUE;
      if (x < -14 && up > 0.4) c = NAVY; // tail cone livery sweep
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nr; j++) {
    const a = i * nr + j, b = i * nr + ((j + 1) % nr), c = (i + 1) * nr + j, d = (i + 1) * nr + ((j + 1) % nr);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return orient(g);
}

export class B737Model {
  readonly root = new THREE.Group();
  readonly exterior = new THREE.Group();
  private fuselageMesh: THREE.Mesh;
  private flaps: THREE.Object3D[] = [];
  private ailL!: THREE.Object3D; private ailR!: THREE.Object3D;
  private spoilers: THREE.Object3D[] = [];
  private elev: THREE.Object3D[] = [];
  private rudder: THREE.Object3D;
  private fans: THREE.Object3D[] = [];
  private reversers: THREE.Object3D[] = [];
  private mainGear: THREE.Group[] = [];
  private noseGear = new THREE.Group();
  private noseSteer = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private beacons: THREE.Mesh[] = [];
  private strobes: THREE.Mesh[] = [];
  private navs: THREE.Mesh[] = [];
  landingLight: THREE.SpotLight;
  private t = 0;
  /** Real 737-800 mesh (public/models/b738.fbx) once loaded; replaces the procedural exterior. */
  private real: THREE.Group | null = null;
  private rig: B737Rig | null = null;
  private restMatrix = new THREE.Matrix4();

  constructor() {
    this.root.name = 'B738';
    this.root.add(this.exterior);
    this.fuselageMesh = new THREE.Mesh(fuselage(), paint);
    this.fuselageMesh.castShadow = this.fuselageMesh.receiveShadow = true;
    this.exterior.add(this.fuselageMesh);

    // ---- wings with blended winglets
    const af = naca(0.02, 0.4, 0.12, 22);
    const st = (y: number, side: number) => {
      const chord = b738ChordAt(y);
      return { le: new THREE.Vector3(b738QcX(y) + 0.25 * chord, side * y, b738WingZ(y)), chord, inc: (1.0 - 3.0 * ((y - 1.9) / 15.26)) * Math.PI / 180 };
    };
    for (const side of [-1, 1]) {
      const ys = [1.4, 1.9, 4.5, 6.3, 8.5, 10.4, 12.5, 13.8, 15.5, 17.16];
      const main = orient(loftWing(airfoilPart(af, 0, 0.72), ys.map((y) => st(y, side))));
      const m = new THREE.Mesh(main, grey); m.castShadow = m.receiveShadow = true;
      this.exterior.add(m);
      // leading-edge slats band (painted white on the grey wing)
      const slat = orient(loftWing(airfoilPart(af, 0, 0.12), ys.slice(1).map((y) => { const s = st(y, side); s.le.z -= 0.005; return s; })));
      this.exterior.add(new THREE.Mesh(slat, white));
      const surf = (y0: number, y1: number, a: number, b: number, mat: THREE.Material) => {
        const s0 = st(y0, side), s1 = st(y1, side);
        const hx = s0.le.x - a * s0.chord, hz = s0.le.z;
        const rel = [s0, s1].map((s) => ({ le: new THREE.Vector3(s.le.x - hx, s.le.y, s.le.z - hz), chord: s.chord, inc: s.inc }));
        const pv = new THREE.Group(); pv.position.set(hx, 0, hz);
        // hinge line follows the sweep: rotate the pivot so its y axis lies along the hinge
        // local +y always points to body +y so that +rotation = trailing edge down on both wings
        const dir = new THREE.Vector3((s1.le.x - a * s1.chord) - hx, s1.le.y - s0.le.y, s1.le.z - hz).normalize().multiplyScalar(side);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        pv.quaternion.copy(q);
        const inner = new THREE.Group(); pv.add(inner);
        const g = orient(loftWing(airfoilPart(af, a, b), rel));
        g.applyQuaternion(q.clone().invert());
        const mm = new THREE.Mesh(g, mat); mm.castShadow = true;
        inner.add(mm);
        this.exterior.add(pv);
        return inner;
      };
      this.flaps.push(surf(1.9, 6.3, 0.72, 1.0, grey), surf(6.3, 10.4, 0.72, 1.0, grey));
      const ail = surf(10.4, 13.8, 0.75, 1.0, grey);
      if (side < 0) this.ailL = ail; else this.ailR = ail;
      // spoiler panels (upper surface, hinged ahead of the flaps)
      for (const [y0, y1] of [[4.6, 7.2], [7.2, 10.3], [10.5, 13.6]]) {
        const s0 = st(y0, side), s1 = st(y1, side);
        const pv = new THREE.Group();
        const hx = s0.le.x - 0.55 * s0.chord, hz = s0.le.z - 0.06 * s0.chord;
        pv.position.set(hx, 0, hz);
        const len = Math.abs(y1 - y0);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.17 * (s0.chord + s1.chord) / 2, len, 0.03), grey);
        panel.position.set(-0.085 * (s0.chord + s1.chord) / 2, side * (y0 + len / 2), 0);
        pv.add(panel);
        this.spoilers.push(pv);
        this.exterior.add(pv);
      }
      // blended winglet
      const tip = st(17.16, side);
      const wl = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-1.25, 0), new THREE.Vector2(-1.55, -2.45), new THREE.Vector2(-1.05, -2.45), new THREE.Vector2(0, -0.25)]);
      const wg = new THREE.ExtrudeGeometry(wl, { depth: 0.08, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
      wg.rotateX(Math.PI / 2);
      const wm = new THREE.Mesh(wg, navyMat);
      wm.position.set(tip.le.x - 0.02, side * (17.2 + 0.05), tip.le.z - 0.02);
      wm.rotation.x = side * -0.18; // slight outward cant
      // rotateX(pi/2) maps shape y -> z; the profile was drawn with negative y = upward
      this.exterior.add(wm);
      // engine + pylon
      const eng = this.engine(side);
      this.exterior.add(eng);
      // nav and strobe lights
      const nl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2020 : 0x20ff40 }));
      nl.position.set(tip.le.x - 0.3, side * 17.3, tip.le.z); this.exterior.add(nl); this.navs.push(nl);
      const sm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      sm.position.set(tip.le.x - 0.9, side * 17.3, tip.le.z); this.exterior.add(sm); this.strobes.push(sm);
    }

    // ---- horizontal tail and elevators
    const taf = naca(0, 0.3, 0.1, 16);
    for (const side of [-1, 1]) {
      const hst = (y: number) => {
        const f = y / 7.17;
        const chord = 3.9 - 2.6 * f;
        return { le: new THREE.Vector3(-14.4 - y * Math.tan(32 * Math.PI / 180), side * y, -0.65 - y * Math.tan(7 * Math.PI / 180)), chord, inc: 0 };
      };
      const ys = [0.6, 2.5, 5, 7.17];
      const m = new THREE.Mesh(orient(loftWing(airfoilPart(taf, 0, 0.7), ys.map(hst))), white); m.castShadow = true;
      this.exterior.add(m);
      const s0 = hst(0.6);
      const hx = s0.le.x - 0.7 * s0.chord;
      const pv = new THREE.Group(); pv.position.set(hx, 0, s0.le.z);
      const sw = Math.atan2((hst(7.17).le.x - 0.7 * hst(7.17).chord) - hx, 6.57);
      pv.rotation.z = side * sw; // align hinge with the swept trailing edge
      const inner = new THREE.Group(); pv.add(inner);
      const rel = ys.map((y) => { const s = hst(y); const p = new THREE.Vector3(s.le.x - hx, s.le.y, s.le.z - s0.le.z).applyAxisAngle(new THREE.Vector3(0, 0, 1), -side * sw); return { le: p, chord: s.chord, inc: 0 }; });
      inner.add(new THREE.Mesh(orient(loftWing(airfoilPart(taf, 0.7, 1.0), rel)), white));
      this.exterior.add(pv);
      this.elev.push(inner);
    }

    // ---- fin and rudder
    const fin = (a: number, b: number, hx = 0) => {
      const prof = airfoilPart(taf, a, b);
      const pos: number[] = [], idx: number[] = [];
      const hs = [0, 0.33, 0.66, 1];
      for (const h of hs) {
        const z = -1.75 - h * 6.95, le = -14.2 - h * 5.0, chord = 6.6 - h * 4.4;
        for (const [xc, tc] of prof) pos.push(le - xc * chord - hx, tc * chord * 0.85, z);
      }
      const m = prof.length;
      for (let i = 0; i + 1 < hs.length; i++) for (let j = 0; j < m; j++) {
        const p0 = i * m + j, p1 = i * m + ((j + 1) % m), p2 = (i + 1) * m + j, p3 = (i + 1) * m + ((j + 1) % m);
        idx.push(p0, p2, p1, p1, p2, p3);
      }
      const base = pos.length / 3, top = (hs.length - 1) * m;
      for (let j = 0; j < m; j++) pos.push(pos[(top + j) * 3], pos[(top + j) * 3 + 1], pos[(top + j) * 3 + 2]);
      for (let j = 1; j + 1 < m; j++) idx.push(base, base + j, base + j + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return orient(g);
    };
    const finM = new THREE.Mesh(fin(0, 0.7), navyMat); finM.castShadow = true;
    this.exterior.add(finM);
    this.rudder = new THREE.Group();
    const rhx = -14.2 - 0.5 * 5.0 - 0.7 * (6.6 - 0.5 * 4.4);
    this.rudder.position.set(rhx, 0, 0);
    this.rudder.add(new THREE.Mesh(fin(0.7, 1.0, rhx), navyMat));
    this.exterior.add(this.rudder);
    // tail logo plate (JetVault blue chevron)
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.9, 3), new THREE.MeshBasicMaterial({ color: 0x4f8ef7 }));
    for (const s of [-1, 1]) {
      const l = logo.clone(); l.position.set(-17.6, s * 0.36, -5.0); l.rotation.x = s * Math.PI / 2; l.rotation.z = Math.PI / 2; this.exterior.add(l);
    }

    // ---- landing gear
    const wheel = (r: number, w: number) => {
      const g = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24), rubber);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 16), grey);
      g.add(t, h);
      return g;
    };
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(-1.5, side * 2.86, 1.5); // attach point = pivot for retraction
      g.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 2.0), 0.14, 0.12, chrome));
      for (const dy of [-0.43, 0.43]) { const w = wheel(0.56, 0.36); w.position.set(0, dy, 1.99); g.add(w); this.wheels.push(w); }
      this.mainGear.push(g);
      this.exterior.add(g);
    }
    this.noseGear.position.set(14.1, 0, 1.6);
    this.noseGear.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1.7), 0.09, 0.08, chrome));
    this.noseSteer.position.set(0, 0, 1.7);
    for (const dy of [-0.28, 0.28]) { const w = wheel(0.38, 0.24); w.position.set(-0.1, dy, 0.3); this.noseSteer.add(w); this.wheels.push(w); }
    this.noseGear.add(this.noseSteer);
    this.exterior.add(this.noseGear);

    // ---- lights
    for (const z of [-1.95, 1.95]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1a1a }));
      b.position.set(-2, 0, z); this.exterior.add(b); this.beacons.push(b);
    }
    this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 1500, 0.2, 0.4, 1.4);
    this.landingLight.position.set(4, 0, 1.0);
    this.landingLight.target.position.set(80, 0, 6);
    this.root.add(this.landingLight, this.landingLight.target);
  }

  private engine(side: number) {
    const g = new THREE.Group();
    g.position.set(0, side * 4.9, 2.3);
    // nacelle: lathe profile along x (radius vs station)
    const prof: [number, number][] = [[3.05, 0.78], [2.9, 0.98], [2.4, 1.04], [1.2, 1.02], [0.0, 0.92], [-0.9, 0.8], [-1.35, 0.62]];
    const pts = prof.map(([x, r]) => new THREE.Vector2(r, x));
    const lathe = new THREE.LatheGeometry(pts, 40);
    lathe.rotateZ(-Math.PI / 2); // lathe axis y -> x
    const nac = new THREE.Mesh(lathe, new THREE.MeshPhysicalMaterial({ color: 0xe9ebee, roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide }));
    nac.position.x = 6.0;
    nac.scale.set(1, 1, 0.94); // flattened bottom ("hamster pouch") approximation
    nac.castShadow = true;
    g.add(nac);
    // fan face and spinner
    const fan = new THREE.Group();
    fan.position.x = 8.75;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), dark);
    disc.rotation.y = Math.PI / 2;
    fan.add(disc);
    for (let i = 0; i < 12; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.74, 0.16), grey);
      bl.position.set(0.01, Math.cos((i / 12) * Math.PI * 2) * 0.42, Math.sin((i / 12) * Math.PI * 2) * 0.42);
      bl.rotation.x = (i / 12) * Math.PI * 2;
      bl.rotation.y = 0.5;
      fan.add(bl);
    }
    const spin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 16), chrome);
    spin.rotation.z = -Math.PI / 2; spin.position.x = 0.25;
    fan.add(spin);
    g.add(fan);
    this.fans.push(fan);
    // exhaust plug
    const plug = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 20), dark);
    plug.rotation.z = Math.PI / 2; plug.position.x = 4.3;
    g.add(plug);
    // thrust reverser sleeve (translates aft when deployed)
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.85, 0.6, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide }));
    sleeve.rotation.z = Math.PI / 2; sleeve.position.x = 5.6;
    g.add(sleeve);
    this.reversers.push(sleeve);
    // pylon
    const py = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.32, 1.2), white);
    py.position.set(5.6, 0, -1.0);
    g.add(py);
    return g;
  }

  /** Wing flex: tip rise in model units, driven by a spring-damper so the wings bounce when the load changes. */
  private flexU = { value: 0 };
  private flexPos = 0; private flexVel = 0;

  update(ac: Aircraft, c: FlightControls, dt: number, night: number) {
    this.t += dt;
    {
      // lift carried by the wings bends the tips up: ~0.8 m at 1 g in the air (less with fuel in the wings), more in turns and gusts; none on the ground
      const target = ac.onGround && ac.tas < 40 ? 0 : 1.1 * Math.max(-0.5, Math.min(3, ac.loadFactor)) + 0.05 * ac.buffet;
      const w = 9, z = 0.3, h = Math.min(dt, 0.05);
      this.flexVel += (w * w * (target - this.flexPos) - 2 * z * w * this.flexVel) * h;
      this.flexPos += this.flexVel * h;
      this.flexU.value = this.flexPos * (1404.4 / 35.79);
    }
    for (const f of this.flaps) f.rotation.y = ac.flap;
    this.ailL.rotation.y = ac.aileronL;
    this.ailR.rotation.y = ac.aileronR;
    for (const e of this.elev) e.rotation.y = ac.elevator;
    this.rudder.rotation.z = ac.rudder;
    for (const s of this.spoilers) s.rotation.y = -ac.spoiler * 0.75;
    ac.engines.forEach((e, i) => {
      if (this.fans[i]) this.fans[i].rotation.x += (e.rpm / 100) * 0.9 * dt * 6;
      const rev = (e as { reverserDeployed?: number }).reverserDeployed ?? 0;
      if (this.reversers[i]) this.reversers[i].position.x = 5.6 - rev * 0.9;
    });
    // gear: retract inboard (mains) and forward (nose)
    const ret = 1 - ac.gearExt;
    if (this.rig) this.rig.update(ac);
    if (this.real) {
      // keep the wheels on the ground: the flight model's tyre contact is gear bottom (z = 4.05 m below the datum)
      // minus strut compression; tilt the mesh so nose and main wheels meet the same plane
      const cn = ac.gearStates[0]?.compression ?? 0;
      const cm = ((ac.gearStates[1]?.compression ?? 0) + (ac.gearStates[2]?.compression ?? 0)) / 2;
      const down = ac.gearExt > 0.99 ? 1 : 0;
      const tilt = down * (cn - cm) / 15.6;
      this.real.matrix.copy(new THREE.Matrix4().makeTranslation(-1.5, 0, 4.05 - down * cm)).multiply(new THREE.Matrix4().makeRotationY(tilt)).multiply(this.restMatrix);
      this.real.matrixWorldNeedsUpdate = true;
    }
    this.mainGear.forEach((g, i) => {
      g.rotation.x = (i === 0 ? -1 : 1) * ret * (Math.PI / 2); // mains fold inboard
      const comp = ac.gearStates[i + 1]?.compression ?? 0;
      g.children.slice(1).forEach((w) => { w.position.z = 1.99 - comp; });
      g.visible = ac.gearExt > 0.02;
    });
    this.noseGear.rotation.y = ret * (Math.PI / 2); // nose gear folds forward
    this.noseGear.visible = ac.gearExt > 0.02;
    this.noseSteer.position.z = 1.7 - (ac.gearStates[0]?.compression ?? 0);
    this.noseSteer.rotation.z = ac.gearStates[0]?.steer ?? 0;
    const pow = c.masterBattery;
    const beacon = c.beacon && pow && (this.t % 1.0) < 0.1;
    for (const b of this.beacons) b.visible = beacon;
    const strobe = c.strobes && pow && (this.t % 1.2) < 0.06;
    for (const s of this.strobes) { s.visible = strobe; s.scale.setScalar(strobe ? 3 : 1); }
    for (const n of this.navs) n.visible = c.navLights && pow;
    this.landingLight.intensity = c.landingLight && pow ? 9000 * (0.3 + night) : 0;
  }

  setCockpitView(inCockpit: boolean) {
    if (!this.glbLoaded) this.fuselageMesh.visible = !inCockpit; // the procedural body stays hidden once the supplied model is in
    if (this.real) this.real.visible = !inCockpit;
  }

  /**
   * Loads the supplied 737-800 FBX (SketchUp-derived, units ~39.2 per metre, y up, nose +z, textures not
   * supplied) and swaps it in for the procedural exterior. Parts are static except the landing gear, which
   * is picked out by position (low, near the main or nose gear) and hidden when the gear is up.
   */
  /**
   * Loads the supplied low-poly glTF 737 (13k triangles, textured, one mesh made of many parts) as the exterior.
   * No separate control surfaces exist in the file, so the surface/flap/gear animation is not available for it.
   */
  async loadGlb(url: string) {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    const parts: string[] = [];
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) parts.push(`${m.name}:${(m.geometry.index?.count ?? 0) / 3}`); });
    console.info('737 glb bbox', box.min.toArray().map((v) => v.toFixed(2)), box.max.toArray().map((v) => v.toFixed(2)), 'parts', parts.length);
    (window as unknown as { __glb?: unknown }).__glb = { size: size.toArray(), ctr: ctr.toArray(), parts };
    // glb axes: x = span, y up, z = length (the nose is at -z; found by comparing against the nose-gear position). Body frame: x forward, y right, z down; wheels' lowest point on z = 0.
    const k = 35.79 / size.x, noseDir = -1;
    const M = new THREE.Matrix4().set(
      0, 0, k * noseDir, 19.4 - k * noseDir * (noseDir > 0 ? box.max.z : box.min.z),
      k * -noseDir, 0, 0, k * ctr.x * noseDir,
      0, -k, 0, k * 0.1 - 2.05, // lowest real geometry (engine nacelles, y = 0.1; a stray 1-triangle outlier at y = -5 is ignored) sits 2.0 m below the datum
      0, 0, 0, 1,
    );
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      for (const mat of ([] as THREE.Material[]).concat(m.material)) {
        const st = mat as THREE.MeshStandardMaterial;
        if (st.isMeshStandardMaterial) { st.metalness = Math.min(st.metalness, 0.2); st.roughness = Math.max(0.35, Math.min(st.roughness, 0.6)); st.side = THREE.DoubleSide; }
      }
    });
    this.restMatrix.copy(M);
    const wrap = new THREE.Group();
    wrap.matrixAutoUpdate = false; wrap.matrix.copy(M); wrap.add(root);
    this.rig = null;
    // the glb has no landing gear: keep only the procedural gear (which follows the flight model) from the old exterior
    this.glbLoaded = true;
    this.fuselageMesh.visible = false;
    for (const c of this.exterior.children) if (!this.mainGear.includes(c as THREE.Group) && c !== this.noseGear) c.visible = false;
    if (this.real) this.root.remove(this.real);
    this.root.add(wrap);
    this.real = wrap;
    wrap.visible = true;
    void size; void ctr;
  }
  glbLoaded = false;
  glbRoot: THREE.Object3D | null = null;
  glbBox: THREE.Box3 | null = null;

  async loadReal(url: string) {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    const mgr = new THREE.LoadingManager();
    mgr.setURLModifier(() => 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
    const LIVERY = ['Material10', 'Material11', 'Material14', 'Material15', 'Material18'];
    const livery = new Set<THREE.MeshPhongMaterial>();
    const whiteRef: { m: THREE.MeshPhongMaterial | null } = { m: null };
    const root = new FBXLoader(mgr).parse(await (await fetch(url)).arrayBuffer(), '');
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of ([] as THREE.Material[]).concat(m.material)) {
        const mm = mat as THREE.MeshPhongMaterial;
        mm.map = null; mm.side = THREE.DoubleSide;
        if (LIVERY.includes(mm.name)) livery.add(mm);
        if (mm.name === 'Color_000') whiteRef.m = mm;
        if ('shininess' in mm) mm.shininess = Math.min(mm.shininess, 40);
      }
      m.castShadow = true; m.receiveShadow = true;
      // The supplied model is painted in a real airline's livery (geometry patches, not textures). Neutralise it:
      // the tail becomes plain navy and the colour patches (lettering, tail art, swooshes, engine lips) become white.
      if (m.name === 'Group_082') m.material = new THREE.MeshPhongMaterial({ color: 0x14254a, shininess: 40, side: THREE.DoubleSide });
    });
    // livery colour patches take the exact look of the white fuselage paint, so no ghost lettering remains
    const white = whiteRef.m;
    if (white) for (const mm of livery) { mm.color.copy(white.color); mm.specular.copy(white.specular); mm.shininess = white.shininess; mm.emissive.copy(white.emissive); }
    // Phong -> physically based: painted aluminium (clear-coated), glass, and bare metal / rubber by colour.
    const pbr = new Map<THREE.Material, THREE.Material>();
    const toPbr = (mat: THREE.Material): THREE.Material => {
      const old = mat as THREE.MeshPhongMaterial;
      let r = pbr.get(mat);
      if (r || !(old as THREE.MeshPhongMaterial).isMeshPhongMaterial) return r ?? mat;
      const c = old.color, lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const base = { color: c.clone(), side: old.side, transparent: old.transparent, opacity: old.opacity, name: old.name };
      if (lum > 0.6) r = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.24, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }); // painted fuselage
      else if (lum < 0.1 && (old.specular?.r ?? 0) > 0.05) r = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03 }); // glass
      else if (lum < 0.07) r = new THREE.MeshStandardMaterial({ ...base, roughness: 0.9, metalness: 0 }); // rubber, dark trim
      else r = new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.33, metalness: 0.75, clearcoat: 0.3, clearcoatRoughness: 0.2 }); // engine, gear, bare metal
      r.onBeforeCompile = (sh) => {
        sh.uniforms.uFlex = this.flexU;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlex;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat flexT = clamp((abs(position.x) - 90.0) / 600.0, 0.0, 1.0);\ntransformed.y += uFlex * flexT * flexT;');
      };
      r.customProgramCacheKey = () => 'b737flex';
      r.userData.envI = lum > 0.6 ? 2.0 : lum < 0.07 ? 0.4 : 2.2;
      pbr.set(mat, r);
      return r;
    };
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map(toPbr) : toPbr(m.material);
    });
    // model (x span, y up, z nose) -> body FRD metres; pitched ~2 deg nose-up about the main wheels so the
    // nose and main wheels sit on the same plane as the flight model's gear
    const s = 35.79 / 1404.4;
    const P = new THREE.Matrix4().set(0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    const m = new THREE.Matrix4()
      .makeTranslation(-1.5, 0, 4.0)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(P)
      .multiply(new THREE.Matrix4().makeRotationX(-2.06 * Math.PI / 180))
      .multiply(new THREE.Matrix4().makeTranslation(0, -22, 3));
    // rig the control surfaces in model space (before the model is placed under the scaling wrapper)
    try { this.rig = new B737Rig(root); console.info('737 rig:', this.rig.report.join('; ')); } catch (e) { console.warn('737 rig failed; model stays static', e); }
    this.restMatrix.copy(new THREE.Matrix4().makeScale(s, s, s).multiply(P).multiply(new THREE.Matrix4().makeRotationX(-2.06 * Math.PI / 180)).multiply(new THREE.Matrix4().makeTranslation(0, -22, 3)));
    const wrap = new THREE.Group();
    wrap.matrixAutoUpdate = false; wrap.matrix.copy(m);
    wrap.add(root);
    this.exterior.visible = false;
    this.root.add(wrap);
    this.real = wrap;
    wrap.visible = true;
  }
}
