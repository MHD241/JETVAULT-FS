// Director mode: the player flies a floating camera drone (the rig's free camera) while a scripted pilot flies the aircraft. This class adds what the plain free
// camera lacks: click to capture the mouse for looking around, speed keys, a restart key and hiding the interface for a clean picture.
import type { CameraRig } from './render/cameras';

/** One Director shot: which aircraft does what, where, and when (date and time of day, UTC) with what clouds. */
export interface DirectorShot { aircraft: string; kind: 'takeoff' | 'landing' | 'cruise'; runway: string; dayOfYear: number; timeOfDay: number; cloud: 'SKC' | 'FEW' | 'SCT' | 'BKN' | 'OVC' }

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
