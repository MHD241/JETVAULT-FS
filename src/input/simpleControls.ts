// Simplified JetVault controls.
// Desktop: mouse position = stick (pitch/roll), 1-9 throttle, Left/Right arrows rudder,
//          B spoilers, Space brakes (hold), G gear, F flaps (cycles), C camera, Esc menu.
// Touch:   joystick (left) = stick, throttle slider (right), buttons for gear, flaps,
//          spoilers, brakes (hold) and camera.
// Assists (always on): rudder coordination / ground heading hold via the pedals, and
// auto-trim when the stick is centred. They move controls only, not the aircraft.

import { FlightControls } from '../sim/controls';
import { Aircraft } from '../sim/fdm/aircraft';
import { clamp } from '../core/math';

export const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

export type SimpleEvent = 'gear' | 'flaps' | 'spoilers' | 'camera' | 'menu' | 'bridge' | 'park' | 'push' | 'launch' | 'bungee';

export class SimpleControls {
  private keys = new Set<string>();
  private events: SimpleEvent[] = [];
  private mouse = { x: 0, y: 0, active: false };
  private joy = { x: 0, y: 0 };
  private joySmooth = { x: 0, y: 0 };
  private mouseSmooth = { x: 0, y: 0 };
  private knobEl: HTMLDivElement | null = null;
  private touchBrake = false;
  private pedal = 0;
  private holdHdg: number | null = null;
  throttle = 0;
  parking = true;
  /** Driving the pushback tug: steering input goes to the tug, aircraft controls are neutral. */
  tugMode = false;
  /** Beginner assists (auto-trim, rudder coordination, ground heading hold). Off = realistic mode: the stick and pedals are the only inputs (the 737 keeps its yaw damper, a real system). */
  assists = (() => { try { return localStorage.getItem('jetvault.assists') !== '0'; } catch { return true; } })();
  setAssists(on: boolean) { this.assists = on; try { localStorage.setItem('jetvault.assists', on ? '1' : '0'); } catch { /* ignore */ } }
  /** "GeoFS-style" forgiving handling: wings level themselves when the stick is released (desktop too). Physics unchanged. */
  arcade = (() => { try { return localStorage.getItem('jetvault.arcade') === '1'; } catch { return false; } })();
  setArcade(on: boolean) { this.arcade = on; try { localStorage.setItem('jetvault.arcade', on ? '1' : '0'); } catch { /* ignore */ } }
  /** Parking brake on the towed aircraft while driving the retrieval buggy (on until the rope is hooked up). */
  tugHold = false;
  tugSteer = 0;
  rawPitch = 0;
  readonly ui: HTMLDivElement;
  private slider: HTMLInputElement | null = null;

  constructor(canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) {
        const d = /^Digit([1-9])$/.exec(e.code);
        if (d) this.setThrottle((Number(d[1]) - 1) / 8); // 1 = idle ... 9 = full
        if (e.code === 'KeyG') this.events.push('gear');
        if (e.code === 'KeyF') this.events.push('flaps');
        if (e.code === 'KeyB') this.events.push('spoilers');
        if (e.code === 'KeyC') this.events.push('camera');
        if (e.code === 'KeyJ') this.events.push('bridge');
        if (e.code === 'KeyU') this.events.push('push');
        if (e.code === 'KeyL' || e.code === 'KeyR') this.events.push('launch');
        if (e.code === 'KeyN') this.events.push('bungee');
        if (e.code === 'KeyK') this.events.push('park');
        if (e.code === 'Escape') this.events.push('menu');
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // the stick follows the pointer over the WHOLE window: panels, readouts and buttons drawn on top of the canvas
    // must not make the stick snap back to neutral (it only recentres when the pointer leaves the page)
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      this.mouse.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      this.mouse.active = true;
    });
    document.documentElement.addEventListener('mouseleave', () => { this.mouse.active = false; });

    this.ui = document.createElement('div');
    this.ui.className = 'jv-touch';
    if (IS_TOUCH) this.buildTouchUI();
    document.body.appendChild(this.ui);
  }

  setThrottle(v: number) {
    this.throttle = clamp(v, 0, 1);
    if (this.slider) this.slider.value = String(this.throttle);
  }

  consume(): SimpleEvent[] { const e = this.events; this.events = []; return e; }

  private buildTouchUI() {
    this.ui.innerHTML = `
      <div class="jv-joy"><div class="jv-joy-knob"></div></div>
      <div class="jv-thr"><span>THR</span><input type="range" min="0" max="1" step="0.01" value="0" orient="vertical"></div>
      <div class="jv-btns">
        <button data-e="gear">GEAR</button><button data-e="flaps">FLAPS</button>
        <button data-e="spoilers">SPLR</button><button data-b="1">BRAKE</button><button data-e="camera">VIEW</button><button data-e="menu">MENU</button>
      </div>`;
    const joy = this.ui.querySelector('.jv-joy') as HTMLDivElement;
    const knob = this.ui.querySelector('.jv-joy-knob') as HTMLDivElement;
    this.knobEl = knob;
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect();
      const R = r.width / 2;
      let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.joy.x = x; this.joy.y = y;
    };
    joy.addEventListener('pointerdown', (e) => { id = e.pointerId; joy.setPointerCapture(e.pointerId); move(e); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = null; this.joy.x = 0; this.joy.y = 0; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
    this.slider = this.ui.querySelector('.jv-thr input') as HTMLInputElement;
    this.slider.addEventListener('input', () => { this.throttle = Number(this.slider!.value); });
    this.ui.querySelectorAll('button[data-e]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.events.push((b as HTMLElement).dataset.e as SimpleEvent); }));
    const brake = this.ui.querySelector('button[data-b]') as HTMLButtonElement;
    brake.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touchBrake = true; brake.classList.add('on'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) brake.addEventListener(ev, () => { this.touchBrake = false; brake.classList.remove('on'); });
  }

  update(dt: number, c: FlightControls, ac: Aircraft) {
    // stick: touch joystick, else mouse position (dead zone in the centre)
    const dz = (v: number, d: number) => (Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d));
    // response curve: much finer control near the centre, full deflection at the edge (0.3 linear + 0.7 cubic)
    const expo = (v: number) => { const x = Math.max(-1, Math.min(1, v)); return 0.3 * x + 0.7 * x * x * x; };
    let pitch = 0, roll = 0;
    if (IS_TOUCH) {
      // smooth the raw finger position (low-pass) and soften the centre with an expo curve
      const a = 1 - Math.exp(-dt / 0.07);
      this.joySmooth.x += (this.joy.x - this.joySmooth.x) * a;
      this.joySmooth.y += (this.joy.y - this.joySmooth.y) * a;
      pitch = expo(this.joySmooth.y); roll = expo(this.joySmooth.x);
      if (this.knobEl) {
        const R = (this.knobEl.parentElement as HTMLElement).clientWidth / 2;
        this.knobEl.style.transform = `translate(${this.joySmooth.x * R * 0.62}px, ${this.joySmooth.y * R * 0.62}px)`;
      }
    }
    else {
      // mouse: low-pass the stick (a flick no longer snaps the controls), gentler gain and a wider dead zone;
      // an airliner has heavier controls, so its stick travel is scaled down (more so at speed on the ground)
      const jet = !!ac.def.turbofans;
      const tx = this.mouse.active ? dz(this.mouse.x, 0.1) : 0, ty = this.mouse.active ? dz(this.mouse.y, 0.1) : 0;
      const a = 1 - Math.exp(-dt / (jet ? 0.16 : 0.09));
      this.mouseSmooth.x += (tx - this.mouseSmooth.x) * a; this.mouseSmooth.y += (ty - this.mouseSmooth.y) * a;
      const g = jet ? 1.0 : 1.15, auth = jet ? 0.8 : 1;
      pitch = expo(this.mouseSmooth.y * g) * auth; roll = expo(this.mouseSmooth.x * g) * auth;
    }
    // touch: with the stick released in the air, gently level the wings (aileron input only)
    const stickFree = IS_TOUCH ? Math.abs(this.joy.x) < 0.05 : Math.abs(roll) < 0.03;
    const drone = !!ac.def.drone;                                     // the inspection drone is a flying camera: no damper, no self-levelling, no rudder assist, nothing fights the stick
    if (ac.def.wave && !drone && !ac.onGround) roll = clamp(roll - 0.9 * ac.omega.x, -1, 1); // roll-rate damper (the Darter's small wings have little natural roll damping)
    if ((IS_TOUCH || this.arcade || ac.def.wave) && !drone && !ac.onGround && stickFree) {
      const bank = ac.euler[0];
      if (Math.abs(bank) < (this.arcade ? 1.2 : 0.7)) roll = clamp(-1.6 * bank - 0.5 * ac.omega.x, -0.5, 0.5);
    }
    c.pitch = clamp(pitch, -1, 1);
    c.roll = clamp(roll, -1, 1);
    this.rawPitch = c.pitch;
    // rudder: arrows, with coordination / heading-hold assist
    const k = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    this.pedal = k ? clamp(this.pedal + k * 2 * dt, -1, 1) : this.pedal * Math.max(0, 1 - 6 * dt);
    if (this.tugMode) {
      // the steering wheel stays where you leave it (no self-centring); Up arrow or X re-centres it
      this.tugSteer = this.keys.has('ArrowUp') || this.keys.has('KeyX') ? 0 : clamp(this.tugSteer + (k + roll) * 0.4 * dt, -1, 1);
      c.pitch = 0; c.roll = 0; c.yaw = 0.5 * this.tugSteer;
      c.throttle = 0.1;
      const brk = this.keys.has('Space') || this.touchBrake ? 1 : 0;
      c.brakeLeft = brk; c.brakeRight = brk; c.parkingBrake = this.tugHold;
      return;
    }
    let assist = 0;
    // on the ground the stick's roll axis steers (nosewheel/rudder), as with a mouse or joystick tiller
    const gs = Math.hypot(ac.vel.x, ac.vel.y);
    const steer = ac.onGround ? c.roll * (ac.def.turbofans ? 1 / (1 + gs / 18) : 1) : 0; // nosewheel authority fades with speed on a jet
    const heading = ac.euler[2];
    if (drone) { this.holdHdg = null; assist = 0; }
    else if (!ac.onGround) {
      // jets: yaw damper (rudder against yaw rate); the old sideslip-driven rudder made the 737 wallow
      // (headless, hands off: rms yaw rate 0.5 deg/s with it vs 0.07 deg/s with the damper)
      assist = ac.def.turbofans || ac.def.wave ? -4.6 * ac.q.invRotate(ac.omega).z - (ac.def.wave ? ac.beta * 3 : 0) : this.assists ? ac.beta * 4 : 0;
      this.holdHdg = null;
    }
    else if (this.assists && Math.hypot(ac.vel.x, ac.vel.y) > 1.5 && !k && Math.abs(steer) < 0.05) {
      if (this.holdHdg === null) this.holdHdg = heading;
      let e = this.holdHdg - heading; e = Math.atan2(Math.sin(e), Math.cos(e));
      assist = e * 6 - ac.q.rotate(ac.omega).z * 2.5;
    } else this.holdHdg = null;
    c.yaw = clamp(this.pedal + steer + assist, -1, 1);
    c.throttle = this.throttle;
    const brake = this.keys.has('Space') || this.touchBrake ? 1 : 0;
    c.brakeLeft = brake; c.brakeRight = brake;
    c.parkingBrake = this.parking;
  }
}
