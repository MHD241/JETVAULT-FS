// Original procedural two-seat glider model (no third-party assets), authored in the flight
// model's body frame (FRD) so control surfaces and airbrakes follow the simulation state.

import * as THREE from 'three';
import { Aircraft } from '../sim/fdm/aircraft';
import { FlightControls } from '../sim/controls';
import { naca, airfoilPart, loftWing, orient } from './c172Model';
import { gliderChordAt } from '../sim/aircraft/glider';

const white = new THREE.MeshPhysicalMaterial({ color: 0xf5f6f8, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
const red = new THREE.MeshPhysicalMaterial({ color: 0xc23b2e, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x20303c, roughness: 0.03, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.55 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.8 });
const plate = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, side: THREE.DoubleSide });

const WING_X = 0.3, WING_Z = -0.32, DIH = 3 * Math.PI / 180;

// fuselage stations: x, half width, top z, bottom z (FRD, up = -z)
const FUS: [number, number, number, number][] = [
  [2.15, 0.04, -0.05, 0.18], [2.0, 0.2, -0.2, 0.33], [1.6, 0.3, -0.45, 0.45], [1.1, 0.34, -0.62, 0.5], [0.6, 0.35, -0.68, 0.52],
  [0.0, 0.33, -0.6, 0.5], [-0.8, 0.26, -0.5, 0.42], [-1.8, 0.18, -0.4, 0.32], [-3.0, 0.12, -0.32, 0.22], [-4.2, 0.09, -0.3, 0.12], [-5.1, 0.05, -0.28, 0.0],
];

function fuselage() {
  const nr = 18, pos: number[] = [], col: number[] = [], idx: number[] = [];
  const w = new THREE.Color(0xf5f6f8), r = new THREE.Color(0xc23b2e);
  FUS.forEach(([x, hw, top, bot], i) => {
    const zc = (top + bot) / 2, hh = (bot - top) / 2;
    for (let j = 0; j < nr; j++) {
      const a = (j / nr) * Math.PI * 2;
      pos.push(x, hw * Math.cos(a), zc + hh * Math.sin(a));
      const c = i >= 8 && i <= 9 ? r : w; // red tail-boom band
      col.push(c.r, c.g, c.b);
    }
  });
  for (let i = 0; i + 1 < FUS.length; i++) for (let j = 0; j < nr; j++) {
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

const paintV = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, vertexColors: true });

export class GliderModel {
  readonly root = new THREE.Group();
  readonly exterior = new THREE.Group();
  private ailL!: THREE.Object3D; private ailR!: THREE.Object3D;
  private elev!: THREE.Object3D; private rudder!: THREE.Object3D;
  private brakes: THREE.Object3D[] = [];
  private wheel: THREE.Object3D;
  landingLight = new THREE.SpotLight(0xffffff, 0);

  constructor() {
    this.root.name = 'Glider';
    this.root.add(this.exterior);
    const fus = new THREE.Mesh(fuselage(), paintV);
    fus.castShadow = true;
    this.exterior.add(fus);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), glass);
    canopy.scale.set(0.95, 0.3, 0.27); canopy.position.set(0.95, 0, -0.62);
    this.exterior.add(canopy);

    // wings
    const af = naca(0.02, 0.4, 0.14, 22);
    const st = (y: number, side: number) => {
      const chord = gliderChordAt(y);
      const inc = (2.2 - 2.5 * (y / 8.5)) * Math.PI / 180;
      return { le: new THREE.Vector3(WING_X + 0.25 * chord, side * y, WING_Z - y * Math.tan(DIH)), chord, inc };
    };
    for (const side of [-1, 1]) {
      const ys = [0.3, 1.6, 3.2, 4.8, 6.4, 7.6, 8.45];
      const main = orient(loftWing(airfoilPart(af, 0, 0.78), ys.map((y) => st(y, side))));
      const wm = new THREE.Mesh(main, white); wm.castShadow = true; wm.receiveShadow = true;
      this.exterior.add(wm);
      // aileron 4.8 .. 8.4, hinge at 78 % chord
      const s0 = st(4.8, side), s1 = st(8.4, side);
      const hingeX = s0.le.x - 0.78 * s0.chord, hingeZ = s0.le.z;
      const rel = [s0, s1].map((s) => ({ le: new THREE.Vector3(s.le.x - hingeX, s.le.y, s.le.z - hingeZ), chord: s.chord, inc: s.inc }));
      const ail = new THREE.Group(); ail.position.set(hingeX, 0, hingeZ);
      const am = new THREE.Mesh(orient(loftWing(airfoilPart(af, 0.78, 1.0), rel)), red); am.castShadow = true;
      ail.add(am); this.exterior.add(ail);
      if (side < 0) this.ailL = ail; else this.ailR = ail;
      // airbrake plate, hinged at its aft edge on the upper surface
      const p = st(2.4, side);
      const hx = p.le.x - 0.6 * p.chord, hz = p.le.z - 0.08 * p.chord - 0.01;
      const brake = new THREE.Group(); brake.position.set(hx, side * 2.4, hz);
      const pm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.5, 0.012), plate); pm.position.set(0.13, 0, 0);
      brake.add(pm); this.exterior.add(brake); this.brakes.push(brake);
    }

    // T-tail: fin (fixed 0..60 %), rudder, stabiliser and elevator
    const finShape = (x0: number, x1: number, x2: number, x3: number) => new THREE.Shape([new THREE.Vector2(x0, -0.28), new THREE.Vector2(x1, -0.28), new THREE.Vector2(x2, -1.5), new THREE.Vector2(x3, -1.5)]);
    const extrudeXZ = (shape: THREE.Shape) => { const g = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, 0.035, 0); return g; };
    const fin = new THREE.Mesh(extrudeXZ(finShape(-3.75, -4.7, -4.9, -4.3)), white); fin.castShadow = true;
    this.exterior.add(fin);
    this.rudder = new THREE.Group(); this.rudder.position.set(-4.7, 0, 0);
    const rud = new THREE.Mesh(extrudeXZ(new THREE.Shape([new THREE.Vector2(0, -0.28), new THREE.Vector2(-0.4, -0.28), new THREE.Vector2(-0.45, -1.5), new THREE.Vector2(0.15, -1.5)])), red);
    this.rudder.add(rud); this.exterior.add(this.rudder);
    const tailAf = naca(0, 0, 0.09, 18);
    const tz = -1.48;
    const stab = (y: number) => ({ le: new THREE.Vector3(-4.35 - 0.0 * y, y, tz), chord: 0.82 - 0.3 * (y / 1.55), inc: 0 });
    const sGeo = orient(loftWing(airfoilPart(tailAf, 0, 0.6), [-1.55, -0.8, 0, 0.8, 1.55].map((y) => stab(Math.abs(y)) && { ...stab(Math.abs(y)), le: new THREE.Vector3(stab(Math.abs(y)).le.x, y, tz) })));
    this.exterior.add(new THREE.Mesh(sGeo, white));
    const hx = -4.35 - 0.6 * 0.7;
    const eRel = [-1.55, 0, 1.55].map((y) => { const s = stab(Math.abs(y)); return { le: new THREE.Vector3(s.le.x - hx, y, 0), chord: s.chord, inc: 0 }; });
    this.elev = new THREE.Group(); this.elev.position.set(hx, 0, tz);
    this.elev.add(new THREE.Mesh(orient(loftWing(airfoilPart(tailAf, 0.6, 1.0), eRel)), red));
    this.exterior.add(this.elev);

    // wheels and skid
    this.wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 18), dark);
    this.wheel.position.set(0.15, 0, 0.4); this.exterior.add(this.wheel);
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), dark); tw.position.set(-4.6, 0, 0.24); this.exterior.add(tw);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.03), dark); skid.position.set(2.05, 0, 0.3); this.exterior.add(skid);

    this.landingLight.visible = false;
    this.root.add(this.landingLight, this.landingLight.target);
  }

  update(ac: Aircraft, _c: FlightControls, _dt: number, _night: number) {
    this.ailL.rotation.y = ac.aileronL;
    this.ailR.rotation.y = ac.aileronR;
    this.elev.rotation.y = ac.elevator;
    this.rudder.rotation.z = ac.rudder;
    for (const b of this.brakes) b.rotation.y = ac.spoiler * 1.35;
  }

  setCockpitView(inCockpit: boolean) {
    this.exterior.children[0].visible = !inCockpit;
    this.exterior.children[1].visible = !inCockpit;
  }
}

/** Minimal instrument panel and canopy rails seen from the cockpit view. */
export class GliderCockpit {
  readonly root = new THREE.Group();
  constructor() {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.22), dark); panel.position.set(1.45, 0, -0.22);
    const coaming = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.04), dark); coaming.position.set(1.35, 0, -0.34);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), dark); stick.position.set(0.95, 0, 0.1);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), dark); seat.position.set(0.25, 0, 0.25);
    this.root.add(panel, coaming, stick, seat);
    this.root.visible = false;
  }
  update(_dt: number, _night: number) { /* instruments are shown on the HUD */ }
}
