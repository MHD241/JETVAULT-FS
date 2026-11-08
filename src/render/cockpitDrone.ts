// Inspection-drone "cockpit": a clear glass ball around the camera (so everything can be seen), a small floor disc and a
// flight stick at the bottom that follows the controls. Body frame (x forward, y right, z down), eye at the origin.
import * as THREE from 'three';
import type { Simulation } from '../sim/simulation';

export class DroneCockpit {
  readonly root = new THREE.Group();
  private stick = new THREE.Group();
  constructor(private sim?: Simulation) {
    const R = this.root, RAD = 1.25;
    // glass: faint tint, seen from inside; thin rings so the ball reads as a ball
    const glass = new THREE.Mesh(new THREE.SphereGeometry(RAD, 48, 32), new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false }));
    glass.renderOrder = 5; R.add(glass);
    const ringMat = new THREE.LineBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.35, depthWrite: false });
    for (const rot of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]] as const) {
      const pts: THREE.Vector3[] = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * RAD, Math.sin(a) * RAD, 0)); }
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat); ring.rotation.set(rot[0], rot[1], rot[2]); R.add(ring);
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5, metalness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xffc81e, roughness: 0.5 });
    // floor disc at the bottom of the ball
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.04, 32), metal); floor.position.set(0.8, 0, 0.72); R.add(floor);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.012, 8, 40), trim); rim.rotation.x = Math.PI / 2; rim.position.set(0.8, 0, 0.7); R.add(rim);
    // flight stick: pivot at the floor, rod up (-z), grip with a button
    this.stick.position.set(0.8, 0, 0.7); R.add(this.stick);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.5, 12).rotateX(Math.PI / 2), metal); rod.position.z = -0.25; this.stick.add(rod);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.07, 6, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.8 })); grip.position.z = -0.55; this.stick.add(grip);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 10), new THREE.MeshStandardMaterial({ color: 0xe03030 })); btn.position.set(0, -0.026, -0.58); btn.rotation.x = Math.PI / 2; this.stick.add(btn);
    const boot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 14).rotateX(-Math.PI / 2), metal); boot.position.z = -0.03; this.stick.add(boot);
    R.traverse((o) => { o.frustumCulled = false; });
    this.root.visible = false;
  }
  update(_dt: number, _night: number) {
    const c = this.sim?.controls; if (!c) return;
    this.stick.rotation.y = 0.32 * c.pitch;
    this.stick.rotation.x = 0.4 * c.roll;
  }
}
