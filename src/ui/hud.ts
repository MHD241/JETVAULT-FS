import { Simulation } from '../sim/simulation';
import { RAD } from '../core/math';

/** Minimal in-flight readout (H toggles). Values come from the instrument indications. */
export class Hud {
  readonly el: HTMLDivElement;
  private cells = new Map<string, HTMLDivElement>();
  private msg: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private top: HTMLDivElement;
  visible = true;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'jv-hud';
    for (const id of ['SPD', 'ALT', 'V/S', 'HDG', 'THR', 'FLAPS', 'GEAR', 'SPLR', 'BRK']) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.innerHTML = `<b>-</b><span>${id}</span>`;
      this.el.appendChild(c);
      this.cells.set(id, c);
    }
    document.body.appendChild(this.el);
    this.msg = document.createElement('div');
    this.msg.className = 'jv-msg';
    document.body.appendChild(this.msg);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'jv-toast';
    this.toastEl.style.opacity = '0';
    document.body.appendChild(this.toastEl);
    this.top = document.createElement('div');
    this.top.className = 'jv-top';
    document.body.appendChild(this.top);
  }

  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? '' : 'none'; }

  toast(text: string, seconds = 2.5) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastTimer = seconds;
  }

  private set(id: string, v: string, cls = '') {
    const c = this.cells.get(id)!;
    const b = c.firstElementChild as HTMLElement;
    if (b.textContent !== v) b.textContent = v;
    const k = `cell ${cls}`;
    if (c.className !== k) c.className = k;
  }

  update(sim: Simulation, dt: number, view: string) {
    this.el.classList.toggle('compact', view === 'cockpit');
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toastEl.style.opacity = '0';
    const ac = sim.aircraft, ind = sim.systems.ind, c = sim.controls;
    this.top.innerHTML = '';
    if (this.visible) {
      this.set('SPD', `${ind.iasKt.toFixed(0)} kt`, ind.stallHorn ? 'bad' : ind.iasKt > ac.def.limits.vno ? 'warn' : '');
      this.set('ALT', `${ind.altitudeFt.toFixed(0)} ft`);
      this.set('V/S', `${(Math.round(ind.vsiFpm / 10) * 10).toFixed(0)}`);
      this.set('HDG', `${Math.round(ind.headingDeg).toString().padStart(3, '0')}°`);
      this.set('THR', `${(c.throttle * 100).toFixed(0)}%`);
      this.set('FLAPS', `${Math.round(ac.flap * RAD)}°`, ac.flap > 0.01 ? 'on' : '');
      this.set('GEAR', !ac.def.retractableGear ? 'FIXED' : ac.gearExt > 0.99 ? 'DOWN' : ac.gearExt > 0.01 ? 'MOVING' : 'UP', ac.gearExt > 0.01 && ac.gearExt < 0.99 ? 'warn' : '');
      this.set('SPLR', ac.spoiler > 0.05 ? 'ON' : 'OFF', ac.spoiler > 0.05 ? 'warn' : '');
      this.set('BRK', c.brakeLeft > 0 ? 'ON' : 'OFF', c.brakeLeft > 0 ? 'warn' : '');
    }
    if (ac.crashed) {
      this.msg.innerHTML = `<div class="big">${ac.crashReason.toUpperCase()}</div><div class="small">Press Esc (or MENU) to fly again</div>`;
    } else if (sim.paused) {
      this.msg.innerHTML = '<div class="big">PAUSED</div><div class="small">P to resume</div>';
    } else {
      this.msg.innerHTML = '';
    }
  }
}
