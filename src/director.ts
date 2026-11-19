// Director mode: the player flies a floating camera drone (the rig's free camera) while a scripted pilot flies the aircraft. This class adds what the plain free
// camera lacks: click to capture the mouse for looking around, speed keys, a restart key and hiding the interface for a clean picture.
import * as THREE from 'three';
import type { CameraRig } from './render/cameras';

/** Where the aircraft and the shot start, passed to a camera function. All vectors are in three.js world coordinates. */
export interface ShotCtx { p: THREE.Vector3; psi: number; fwd: THREE.Vector3; right: THREE.Vector3; p0: THREE.Vector3; fwd0: THREE.Vector3; right0: THREE.Vector3; ground: number }
export interface ShotCam { pos: THREE.Vector3; look: THREE.Vector3; fov: number }
/** One film shot: which aircraft does what, where, and when (date and time of day, UTC) with what clouds; optionally a scripted camera. */
export interface DirectorShot {
  id: string; title: string; aircraft: string; kind: 'takeoff' | 'landing' | 'cruise'; runway: string; dayOfYear: number; timeOfDay: number;
  cloud: 'SKC' | 'FEW' | 'SCT' | 'BKN' | 'OVC';
  /** Length of the shot in simulated seconds. */
  duration: number;
  /** Approach distance for landings (nm). */
  nm?: number; cruiseAglFt?: number;
  spawn?: { kind: 'air'; east: number; north: number; altFt: number; hdg: number };
  view?: 'cockpit';
  cam?: (t: number, c: ShotCtx) => ShotCam;
  /** Runway camera on a rail: it sits `side` m beside the centreline at `height` m, looks at the aircraft, and the player can only slide it along the runway (W/S, Shift fast). `s0` = start distance from the threshold. */
  rail?: { s0: number; side: number; height: number; fov: number };
}

export class DirectorInput {
  active = false;
  private hidden: { el: HTMLElement; display: string }[] = [];
  private clean = false;
  constructor(private canvas: HTMLCanvasElement, private rig: CameraRig, private opts: { restart: () => void; keepVisible: () => HTMLElement[] }) {
    canvas.addEventListener('click', () => { if (this.active && !this.menuOpen() && document.pointerLockElement !== canvas) { try { void canvas.requestPointerLock(); } catch { /* ignore */ } } });
    document.addEventListener('pointermove', (e) => { if (this.active && document.pointerLockElement === canvas) rig.look(e.movementX, e.movementY); });
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat || this.menuOpen()) return;
      if (e.code === 'KeyZ') rig.freeSpeed = Math.max(0.1, rig.freeSpeed / 1.5);
      else if (e.code === 'KeyX') rig.freeSpeed = Math.min(20, rig.freeSpeed * 1.5);
      else if (e.code === 'KeyR') opts.restart();
      else if (e.code === 'KeyH') this.setClean(!this.clean);
    });
  }
  private menuOpen() { return !!document.querySelector('.jv-menu') && (document.querySelector('.jv-menu') as HTMLElement).style.display !== 'none'; }
  enable(on: boolean) {
    this.active = on;
    if (!on) { this.setClean(false); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); this.rig.freeSpeed = 1; }
  }
  /** Hides every on-screen element except the game picture and the menu (so the recording is just the sim); shows them again when off. */
  setClean(on: boolean) {
    if (on === this.clean) return;
    this.clean = on;
    if (!on) { for (const h of this.hidden) h.el.style.display = h.display; this.hidden = []; return; }
    const keep = [this.canvas, ...this.opts.keepVisible()];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('body *'))) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      if (keep.some((k) => k.contains(el) || el.contains(k))) continue;
      this.hidden.push({ el, display: el.style.display }); el.style.setProperty('display', 'none', 'important');
    }
  }
}
