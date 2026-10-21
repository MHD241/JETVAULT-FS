// Keyboard, game controller / joystick (Gamepad API) and mouse-yoke input. Inputs move
// the pilot controls (stick, pedals, levers); they never move the aircraft directly.

import { FlightControls } from '../sim/controls';
import { clamp } from '../core/math';

export type Action =
  | 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'yawLeft' | 'yawRight'
  | 'throttleUp' | 'throttleDown' | 'throttleFull' | 'throttleIdle'
  | 'mixtureRich' | 'mixtureLean' | 'flapsUp' | 'flapsDown' | 'trimUp' | 'trimDown'
  | 'brakes' | 'brakeLeft' | 'brakeRight' | 'parkingBrake'
  | 'viewCockpit' | 'viewChase' | 'viewWing' | 'viewTower' | 'viewFree'
  | 'pause' | 'simRate' | 'menu' | 'autoStart' | 'apToggle' | 'apHdg' | 'apAlt' | 'apUp' | 'apDown'
  | 'debugCollision' | 'perfOverlay' | 'hud' | 'mouseYoke' | 'reset' | 'zoomIn' | 'zoomOut' | 'hdgBugSync';

/** Default bindings (KeyboardEvent.code, optionally prefixed with modifiers "Shift+" / "Ctrl+"). */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  pitchUp: ['ArrowDown', 'Numpad2'], pitchDown: ['ArrowUp', 'Numpad8'],
  rollLeft: ['ArrowLeft', 'Numpad4'], rollRight: ['ArrowRight', 'Numpad6'],
  yawLeft: ['KeyZ', 'Numpad0'], yawRight: ['KeyX', 'NumpadEnter'],
  throttleUp: ['PageUp', 'F3', 'Equal'], throttleDown: ['PageDown', 'F2', 'Minus'],
  throttleFull: ['F4'], throttleIdle: ['F1'],
  mixtureRich: ['Shift+KeyM'], mixtureLean: ['KeyM'],
  flapsUp: ['F6', 'BracketLeft'], flapsDown: ['F7', 'BracketRight'],
  trimUp: ['Numpad1', 'End'], trimDown: ['Numpad7', 'Home'],
  brakes: ['Period'], brakeLeft: ['Comma'], brakeRight: ['Slash'], parkingBrake: ['Ctrl+Period', 'KeyB'],
  viewCockpit: ['Digit1'], viewChase: ['Digit2'], viewWing: ['Digit3'], viewTower: ['Digit4'], viewFree: ['Digit5'],
  pause: ['KeyP'], simRate: ['KeyR'], menu: ['Escape'], autoStart: ['Ctrl+KeyE'],
  apToggle: ['Shift+KeyA'], apHdg: ['Shift+KeyH'], apAlt: ['Shift+KeyL'], apUp: ['Shift+PageUp'], apDown: ['Shift+PageDown'],
  debugCollision: ['F8'], perfOverlay: ['F10', 'Backquote'], hud: ['KeyH'], mouseYoke: ['KeyY'], reset: ['Ctrl+KeyR'],
  zoomIn: ['NumpadAdd'], zoomOut: ['NumpadSubtract'], hdgBugSync: ['Shift+KeyD'],
};

export interface InputSettings {
  bindings: Record<Action, string[]>;
  /** Keyboard control deflection rate (full travel per second). */
  keyRate: number;
  /** Controller axis dead zone 0..0.3 and sensitivity exponent (1 = linear). */
  deadZone: number;
  curve: number;
  /** Beginner assistance: automatic rudder coordination (physics unchanged). */
  autoRudder: boolean;
  invertPitch: boolean;
  /** Axis mapping for game controllers / joysticks. */
  axes: { pitch: number; roll: number; yaw: number; throttle: number };
}

const STORE = 'jetvault.input.v1';

export function loadInputSettings(): InputSettings {
  const def: InputSettings = {
    bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)), keyRate: 1.6, deadZone: 0.06, curve: 1.6, autoRudder: true, invertPitch: false,
    axes: { pitch: 1, roll: 0, yaw: 2, throttle: 3 },
  };
  try {
    const s = localStorage.getItem(STORE);
    if (s) { const v = JSON.parse(s); return { ...def, ...v, bindings: { ...def.bindings, ...(v.bindings ?? {}) } }; }
  } catch { /* storage unavailable */ }
  return def;
}

export function saveInputSettings(s: InputSettings) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ }
}

export class InputManager {
  private down = new Set<string>();
  private pressedQueue: Action[] = [];
  private stickPitch = 0; private stickRoll = 0; private pedal = 0;
  mouseYoke = false;
  private mouseX = 0; private mouseY = 0;
  gamepadName = '';
  private gpThrottleSeen = false;
  private lastGpThrottle = NaN;

  constructor(public settings: InputSettings, target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('mousemove', (e) => {
      const r = target.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
  }

  private ctrl = false;
  private shift = false;

  private onKey(e: KeyboardEvent, isDown: boolean) {
    this.ctrl = e.ctrlKey || e.metaKey;
    this.shift = e.shiftKey;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (isDown) {
      if (!this.down.has(e.code)) {
        for (const a of Object.keys(this.settings.bindings) as Action[]) {
          if (this.settings.bindings[a].some((b) => this.matches(b, e.code))) this.pressedQueue.push(a);
        }
      }
      this.down.add(e.code);
      if (/^(F\d+|Arrow|Page|Home|End|Numpad|Backquote|Slash|Space|Period|Comma)/.test(e.code) || this.ctrl) e.preventDefault();
    } else {
      this.down.delete(e.code);
    }
  }

  /** A binding like "Shift+KeyM" matches only with exactly those modifiers held. */
  private matches(binding: string, code: string) {
    const parts = binding.split('+');
    const key = parts.pop()!;
    return key === code && parts.includes('Ctrl') === this.ctrl && parts.includes('Shift') === this.shift;
  }

  /** Is any key bound to the action currently held (continuous actions)? */
  held(a: Action) {
    return this.settings.bindings[a].some((b) => this.down.has(b.split('+').pop()!) && this.matches(b, b.split('+').pop()!));
  }

  /** Discrete actions triggered since the last call. */
  consume(): Action[] { const q = this.pressedQueue; this.pressedQueue = []; return q; }

  /** Applies continuous inputs to the controls. `beta` is sideslip (rad) for auto-rudder. */
  update(dt: number, c: FlightControls, beta: number, onGround: boolean) {
    const s = this.settings;
    const rate = s.keyRate * dt;
    const centre = 2.5 * dt;
    const toward = (v: number, t: number, r: number) => (Math.abs(t - v) <= r ? t : v + Math.sign(t - v) * r);
    // keyboard stick / pedals with auto-centring
    const kp = (this.held('pitchUp') ? 1 : 0) - (this.held('pitchDown') ? 1 : 0);
    const kr = (this.held('rollRight') ? 1 : 0) - (this.held('rollLeft') ? 1 : 0);
    const ky = (this.held('yawRight') ? 1 : 0) - (this.held('yawLeft') ? 1 : 0);
    this.stickPitch = kp ? toward(this.stickPitch, kp, rate) : toward(this.stickPitch, 0, centre);
    this.stickRoll = kr ? toward(this.stickRoll, kr, rate) : toward(this.stickRoll, 0, centre);
    this.pedal = ky ? toward(this.pedal, ky, rate) : toward(this.pedal, 0, centre);
    let pitch = this.stickPitch, roll = this.stickRoll, yaw = this.pedal;
    let throttleAxis: number | null = null;
    let gpBrakeL = 0, gpBrakeR = 0;

    // game controller / joystick
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      this.gamepadName = gp.id;
      const ax = (i: number) => {
        const v = gp.axes[i] ?? 0;
        const dz = s.deadZone;
        const m = Math.abs(v) < dz ? 0 : (Math.abs(v) - dz) / (1 - dz);
        return Math.sign(v) * Math.pow(m, s.curve);
      };
      const gpPitch = (s.invertPitch ? -1 : 1) * ax(s.axes.pitch);
      if (Math.abs(gpPitch) > 0.001 || Math.abs(ax(s.axes.roll)) > 0.001) { pitch = clamp(pitch + gpPitch, -1, 1); roll = clamp(roll + ax(s.axes.roll), -1, 1); }
      const gy = ax(s.axes.yaw);
      if (Math.abs(gy) > 0.001) yaw = clamp(yaw + gy, -1, 1);
      // standard mapping: triggers as brakes, bumpers flaps
      if (gp.mapping === 'standard') {
        gpBrakeL = Math.max(gpBrakeL, gp.buttons[6]?.value ?? 0);
        gpBrakeR = Math.max(gpBrakeR, gp.buttons[7]?.value ?? 0);
      } else if (gp.axes.length > s.axes.throttle) {
        const t = (1 - (gp.axes[s.axes.throttle] ?? 1)) / 2;
        if (!Number.isNaN(this.lastGpThrottle) && Math.abs(t - this.lastGpThrottle) > 0.01) this.gpThrottleSeen = true;
        this.lastGpThrottle = t;
        if (this.gpThrottleSeen) throttleAxis = t;
      }
    }

    if (this.mouseYoke) { pitch = clamp(pitch - this.mouseY * 1.2, -1, 1); roll = clamp(roll + this.mouseX * 1.2, -1, 1); }

    // beginner assistance: coordinate turns with rudder in the air (pilot input still adds)
    if (s.autoRudder && !onGround) yaw = clamp(yaw + beta * 4, -1, 1);

    c.pitch = clamp(pitch, -1, 1);
    c.roll = clamp(roll, -1, 1);
    c.yaw = clamp(yaw, -1, 1);
    if (throttleAxis !== null) c.throttle = throttleAxis;

    // levers
    if (this.held('throttleUp')) c.throttle = clamp(c.throttle + 0.5 * dt, 0, 1);
    if (this.held('throttleDown')) c.throttle = clamp(c.throttle - 0.5 * dt, 0, 1);
    if (this.held('mixtureRich')) c.mixture = clamp(c.mixture + 0.3 * dt, 0, 1);
    if (this.held('mixtureLean')) c.mixture = clamp(c.mixture - 0.3 * dt, 0, 1);
    if (this.held('trimUp')) c.trim = clamp(c.trim + 0.25 * dt, -1, 1);
    if (this.held('trimDown')) c.trim = clamp(c.trim - 0.25 * dt, -1, 1);
    const both = this.held('brakes') ? 1 : 0;
    c.brakeLeft = Math.max(both, this.held('brakeLeft') ? 1 : 0, gpBrakeL);
    c.brakeRight = Math.max(both, this.held('brakeRight') ? 1 : 0, gpBrakeR);
  }
}
