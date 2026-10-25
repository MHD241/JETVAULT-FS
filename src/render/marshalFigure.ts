// A ramp marshaller in hi-vis with two lit wands. Authored in the pilot's frame: +x = the pilot's right,
// +z = towards the pilot (the figure faces +z), +y up. The figure is drawn about 1.35x life size so the
// signals can be read from 60+ m away.

import * as THREE from 'three';
import type { MarshalSignal } from '../sim/marshal';
import { enuToThree } from './coords';

const SCALE = 1.35;

export class MarshalFigure {
  readonly group = new THREE.Group();
  private arms: { pivot: THREE.Group; side: number }[] = [];
  private wandMats: THREE.MeshBasicMaterial[] = [];

  constructor() {
    const vest = new THREE.MeshLambertMaterial({ color: 0xf5a30a }), dark = new THREE.MeshLambertMaterial({ color: 0x23272e });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89878 }), white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x2a3b57 }), red = new THREE.MeshLambertMaterial({ color: 0xc02820 });
    const body = new THREE.Group(); body.scale.setScalar(SCALE); this.group.add(body);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); return o; };
    add(new THREE.BoxGeometry(0.34, 0.55, 0.2), vest, 0, 1.25, 0);
    add(new THREE.BoxGeometry(0.34, 0.2, 0.2), dark, 0, 0.9, 0);
    for (const x of [-0.09, 0.09]) add(new THREE.BoxGeometry(0.13, 0.82, 0.16), dark, x, 0.45, 0);
    add(new THREE.SphereGeometry(0.11, 12, 10), skin, 0, 1.68, 0);
    add(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 1.7, 0); // helmet
    for (const x of [-0.12, 0.12]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateZ(Math.PI / 2), red, x, 1.68, 0); // ear defenders
    add(new THREE.BoxGeometry(0.36, 0.05, 0.22), white, 0, 1.3, 0.001); // reflective band
    for (const side of [1, -1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.24, 1.46, 0); body.add(pivot);
      add(new THREE.BoxGeometry(0.09, 0.56, 0.09), sleeve, 0, -0.28, 0, pivot);
      add(new THREE.SphereGeometry(0.05, 8, 6), skin, 0, -0.58, 0, pivot);
      const wm = new THREE.MeshBasicMaterial({ color: 0xff7a1a }); this.wandMats.push(wm);
      add(new THREE.CylinderGeometry(0.03, 0.045, 0.5, 8), wm, 0, -0.82, 0, pivot);
      this.arms.push({ pivot, side });
    }
    this.group.visible = false;
  }

  /** Stand at east/north on the ground, signalling to an aircraft that approaches along `heading` (compass rad, the aircraft's nose direction). */
  place(e: number, n: number, h: number, heading: number) {
    this.group.position.copy(enuToThree(e, n, h));
    this.group.rotation.set(0, -heading, 0);
  }

  /** Pose both arms for the signal. Arm angle: 0 = hanging down, +/-PI = straight up, sideways = PI/2 (positive on the pilot's right). */
  pose(signal: MarshalSignal, t: number) {
    const R = this.arms.find((a) => a.side > 0)!.pivot, L = this.arms.find((a) => a.side < 0)!.pivot;
    const set = (p: THREE.Group, side: number, out: number, swing = 0) => { p.rotation.set(swing, 0, side * out); };
    const scoop = Math.sin(t * 7) * 0.55;
    switch (signal) {
      case 'ahead': set(R, 1, 2.45 + 0.1 * Math.sin(t * 7), scoop); set(L, -1, 2.45 + 0.1 * Math.sin(t * 7), scoop); break;
      case 'left': set(L, -1, 1.5); set(R, 1, 2.45, scoop); break; // pilot's left arm out, the other beckons
      case 'right': set(R, 1, 1.5); set(L, -1, 2.45, scoop); break;
      case 'slow': { const a = 1.1 + 0.4 * Math.sin(t * 4.5); set(R, 1, a); set(L, -1, a); break; }
      case 'stop': case 'overshoot': { const a = Math.PI + 0.28 + 0.06 * Math.sin(t * 6); set(R, 1, a); set(L, -1, a); break; } // wands crossed overhead
      case 'engines': set(R, 1, 1.45 + 0.25 * Math.sin(t * 9), 0); set(L, -1, 0.12); break; // slashing across the throat
      case 'brakes': set(R, 1, Math.PI * 0.97); set(L, -1, 0.12); break; // one fist overhead: chocks in
      default: { const a = 2.3 + 0.08 * Math.sin(t * 2); set(R, 1, a); set(L, -1, a); } // idle: wands up
    }
  }
}
