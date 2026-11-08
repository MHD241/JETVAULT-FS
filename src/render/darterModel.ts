// Original sci-fi rocket plane for the Darter (no third-party assets): needle nose, delta wing with elevons, twin canted fins,
// glowing rocket nozzle. Authored in the body frame (x forward, y right, z down, metres).

import * as THREE from 'three';
import type { Aircraft } from '../sim/fdm/aircraft';
import type { FlightControls } from '../sim/controls';
import { droneSpeed } from '../sim/fdm/aircraft';

export class DarterModel {
  readonly root = new THREE.Group();
  landingLight = new THREE.SpotLight(0xffffff, 0);
  private elevons: THREE.Group[] = [];
  private fins: THREE.Group[] = [];
  private flame: THREE.Mesh;
  private body: THREE.Object3D[] = [];

  private drone: boolean;
  private engine: THREE.Object3D[] = [];

  constructor(drone = false) {
    this.drone = drone;
    const white = new THREE.MeshPhysicalMaterial({ color: 0xe9edf2, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.5, metalness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.4, metalness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1824, roughness: 0.05, metalness: 0.3, clearcoat: 1, transparent: true, opacity: 0.85 });
    const add = (o: THREE.Object3D, parent: THREE.Object3D = this.root) => { parent.add(o); return o; };
    // fuselage: a needle-nosed teardrop 6.6 m long, max radius 0.42 m (lathe about +y, then turned to point along +x)
    const prof: THREE.Vector2[] = [];
    const L = 6.6, nose = 3.1;
    for (let i = 0; i <= 30; i++) { const t = i / 30, x = -3.3 + t * L; const r = x > nose - 0.0 ? 0.42 * Math.pow(Math.max(0, 1 - (x - nose) / (3.3 - nose + 0.0)), 1) : 0.42 * (0.35 + 0.65 * Math.sin(((x + 3.3) / (nose + 3.3)) * Math.PI / 2)); prof.push(new THREE.Vector2(Math.max(0.02, r), x)); }
    const fus = new THREE.Mesh(new THREE.LatheGeometry(prof, 28).rotateZ(-Math.PI / 2), white); fus.castShadow = true; this.body.push(add(fus));
    const noseTip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 16).rotateZ(-Math.PI / 2), dark); noseTip.position.x = 3.3; add(noseTip);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 12), glass); canopy.scale.set(2.0, 0.8, 0.9); canopy.position.set(1.0, 0, -0.3); add(canopy);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 20).rotateZ(Math.PI / 2), dark); nozzle.position.x = -3.5; add(nozzle);
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.6, 16).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false })); this.flame.position.x = -4.5; add(this.flame);
    // delta wing: leading edge swept 62 deg, span 6 m; elevons on the trailing edge
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape(); sh.moveTo(1.4, 0.3 * s); sh.lineTo(-2.2, 3.0 * s); sh.lineTo(-2.7, 3.0 * s); sh.lineTo(-2.7, 0.3 * s); sh.closePath();
      const w = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false }), white); w.position.z = 0.0; w.castShadow = true; add(w);
      const stripe = new THREE.Mesh(new THREE.ExtrudeGeometry((() => { const q = new THREE.Shape(); q.moveTo(0.9, 0.9 * s); q.lineTo(0.2, 1.6 * s); q.lineTo(-0.3, 1.6 * s); q.lineTo(0.35, 0.9 * s); q.closePath(); return q; })(), { depth: 0.075, bevelEnabled: false }), accent); add(stripe);
      const ev = new THREE.Group(); ev.position.set(-2.7, s * 1.65, 0.035); // hinge line
      const es = new THREE.Shape(); es.moveTo(0, -1.35 * s); es.lineTo(0.55, -1.35 * s); es.lineTo(0.55, 1.35 * s); es.lineTo(0, 1.35 * s); es.closePath();
      const em = new THREE.Mesh(new THREE.ExtrudeGeometry(es, { depth: 0.06, bevelEnabled: false }), dark); em.position.z = -0.03; ev.add(em);
      add(ev); this.elevons.push(ev);
    }
    // twin fins canted outward 20 deg, with rudders
    for (const s of [-1, 1]) {
      const fin = new THREE.Group(); fin.position.set(-2.0, s * 0.5, -0.1); fin.rotation.x = s * 0.35;
      const fs = new THREE.Shape(); fs.moveTo(0.9, 0); fs.lineTo(-0.3, 0); fs.lineTo(-0.6, -1.4); fs.lineTo(0.2, -1.2); fs.closePath();
      const fm = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.06, bevelEnabled: false }), white); fm.rotation.x = Math.PI / 2; fm.position.y = -0.03; fm.castShadow = true; fin.add(fm);
      add(fin); this.fins.push(fin);
    }
    if (drone) {
      // rocket engine: a motor casing riding on the spine, a big flared bell at the tail, cooling rings and a long exhaust plume
      const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.6, 24).rotateZ(Math.PI / 2), dark); casing.position.set(-1.2, 0, -0.62); this.engine.push(add(casing));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 24).rotateZ(Math.PI / 2 * -1), dark); cone.position.set(0.37, 0, -0.62); this.engine.push(add(cone));
      for (const x of [-0.4, -1.2, -2.0]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.03, 8, 28).rotateY(Math.PI / 2), accent); ring.position.set(x, 0, -0.62); this.engine.push(add(ring)); }
      for (const s of [-1, 1]) { const strut = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.28), dark); strut.position.set(-1.2, s * 0.12, -0.42); strut.rotation.x = s * 0.35; this.engine.push(add(strut)); }
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.3, 0.7, 28, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide })); bell.position.set(-2.85, 0, -0.62); this.engine.push(add(bell));
      this.flame.position.set(-4.9, 0, -0.62); this.flame.scale.set(2.4, 1.6, 1.6);
    }
    this.landingLight.visible = false; this.root.add(this.landingLight, this.landingLight.target);
    this.root.name = 'Darter';
  }

  update(ac: Aircraft, c: FlightControls, _dt: number, _night: number) {
    const e = ac.elevator, l = ac.aileronL, r = ac.aileronR;
    this.elevons[0].rotation.y = e + l; this.elevons[1].rotation.y = e + r;
    for (const f of this.fins) f.rotation.z = ac.rudder * 0.8;
    const burn = this.drone ? !!ac.def.drone && droneSpeed(c.throttle, ac.def.drone) > 0 : c.throttle > 0.05 && ac.cable != null;
    (this.flame.material as THREE.MeshBasicMaterial).opacity = burn ? 0.7 + (this.drone ? 0.2 * Math.sin(performance.now() * 0.06) : 0) : 0;
  }

  setCockpitView(inCockpit: boolean) {
    for (const b of this.body) b.visible = !inCockpit;
    if (this.drone) for (const o of this.root.children) if (!(o as THREE.Light).isLight) o.visible = !inCockpit; // the glass ball: see everything, nothing of the airframe in the way
  }
}
