import * as THREE from 'three';
import { Aircraft } from '../sim/fdm/aircraft';
import { Vec3 } from '../core/math';
import { nedToThree, bodyMatrix } from './coords';
import { EYE } from './cockpit';

export type ViewMode = 'cockpit' | 'chase' | 'wing' | 'tower' | 'free';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: ViewMode = 'cockpit';
  headYaw = 0; headPitch = -0.2;
  orbitAz = 0; orbitEl = 0.18; chaseDist = 16;
  fovCockpit = 70; fovExternal = 55;
  towerPos = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  freePos = new THREE.Vector3();
  freeYaw = 0; freePitch = 0;
  private freeKeys = new Set<string>();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 260000);
    window.addEventListener('keydown', (e) => this.freeKeys.add(e.code));
    window.addEventListener('keyup', (e) => this.freeKeys.delete(e.code));
  }

  setMode(m: ViewMode, ac: Aircraft) {
    if (m === 'free' && this.mode !== 'free') {
      this.freePos.copy(this.camera.position);
      const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
      this.freeYaw = Math.atan2(-d.x, -d.z); this.freePitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    }
    this.mode = m;
    this.chaseInit = false;
    this.camera.fov = m === 'cockpit' ? this.fovCockpit : this.fovExternal;
    this.camera.updateProjectionMatrix();
    void ac;
  }

  /** Mouse drag deltas in pixels. */
  look(dx: number, dy: number) {
    const k = 0.004 * (this.camera.fov / 60);
    if (this.mode === 'cockpit') {
      this.headYaw = THREE.MathUtils.clamp(this.headYaw - dx * k, -2.6, 2.6);
      this.headPitch = THREE.MathUtils.clamp(this.headPitch - dy * k, -1.2, 1.2);
    } else if (this.mode === 'free') {
      this.freeYaw -= dx * k; this.freePitch = THREE.MathUtils.clamp(this.freePitch - dy * k, -1.5, 1.5);
    } else {
      this.orbitAz -= dx * 0.006; this.orbitEl = THREE.MathUtils.clamp(this.orbitEl + dy * 0.004, -0.5, 1.4);
    }
  }

  zoom(dir: number) {
    if (this.mode === 'chase') { this.chaseDist = THREE.MathUtils.clamp(this.chaseDist * (dir > 0 ? 0.9 : 1.1), 7, 300); return; }
    const f = THREE.MathUtils.clamp(this.camera.fov * (dir > 0 ? 0.92 : 1.08), 10, 90);
    this.camera.fov = f;
    if (this.mode === 'cockpit') this.fovCockpit = f; else this.fovExternal = f;
    this.camera.updateProjectionMatrix();
  }

  update(ac: Aircraft, dt: number) {
    const cam = this.camera;
    const R = bodyMatrix(ac.q);
    const datum = nedToThree(ac.worldPoint(new Vec3(0, 0, 0)));
    const body = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(R).add(datum);
    if (this.mode === 'cockpit') {
      cam.position.copy(body(EYE.x, EYE.y, EYE.z));
      // camera looks along -z: basis (right, up, back) built from the body axes
      const right = new THREE.Vector3(0, 1, 0).applyMatrix4(R);
      const up = new THREE.Vector3(0, 0, -1).applyMatrix4(R);
      const back = new THREE.Vector3(-1, 0, 0).applyMatrix4(R);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
      const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.headPitch, this.headYaw, 0, 'YXZ'));
      cam.quaternion.copy(q.multiply(head));
    } else if (this.mode === 'chase') {
      // follow the flight path heading, orbit with the mouse
      const fwd = new THREE.Vector3(1, 0, 0).applyMatrix4(R);
      const hdg = Math.atan2(fwd.x, -fwd.z);
      const az = hdg + Math.PI + this.orbitAz;
      const target = datum.clone().add(new THREE.Vector3(0, 1.0, 0));
      const want = target.clone().add(new THREE.Vector3(
        Math.sin(az) * Math.cos(this.orbitEl) * this.chaseDist,
        Math.sin(this.orbitEl) * this.chaseDist,
        -Math.cos(az) * Math.cos(this.orbitEl) * this.chaseDist,
      ));
      if (!this.chaseInit) { this.chasePos.copy(want); this.chaseInit = true; }
      this.chasePos.lerp(want, 1 - Math.exp(-dt * 4));
      // stay above the ground
      cam.position.copy(this.chasePos);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
    } else if (this.mode === 'wing') {
      cam.position.copy(body(-1.2, -6.6, -1.6));
      const up = new THREE.Vector3(0, 0, -1).applyMatrix4(R);
      cam.up.copy(up);
      cam.lookAt(body(2.5 + this.orbitAz * 4, 0.5, -0.6 - this.orbitEl * 3));
    } else if (this.mode === 'tower') {
      cam.position.copy(this.towerPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(datum);
      // keep the aircraft a sensible size on screen
      const d = cam.position.distanceTo(datum);
      cam.fov = THREE.MathUtils.clamp((2 * Math.atan(30 / d) * 180) / Math.PI, 2, 60);
      cam.updateProjectionMatrix();
    } else {
      const speed = (this.freeKeys.has('ShiftLeft') ? 120 : 25) * dt;
      const dir = new THREE.Vector3(-Math.sin(this.freeYaw) * Math.cos(this.freePitch), Math.sin(this.freePitch), -Math.cos(this.freeYaw) * Math.cos(this.freePitch));
      const right = new THREE.Vector3(Math.cos(this.freeYaw), 0, -Math.sin(this.freeYaw));
      if (this.freeKeys.has('KeyW')) this.freePos.addScaledVector(dir, speed);
      if (this.freeKeys.has('KeyS')) this.freePos.addScaledVector(dir, -speed);
      if (this.freeKeys.has('KeyD')) this.freePos.addScaledVector(right, speed);
      if (this.freeKeys.has('KeyA')) this.freePos.addScaledVector(right, -speed);
      if (this.freeKeys.has('KeyE')) this.freePos.y += speed;
      if (this.freeKeys.has('KeyQ')) this.freePos.y -= speed;
      cam.position.copy(this.freePos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.freePos.clone().add(dir));
    }
  }
}
