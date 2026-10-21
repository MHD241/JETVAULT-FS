import { Simulation } from '../sim/simulation';
import { RAD, KT, FT } from '../core/math';

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
    for (const id of ['IAS', 'GS', 'ALT', 'AGL', 'V/S', 'HDG', 'THR', 'RPM', 'FLAPS', 'TRIM', 'BRAKES', 'AP', 'SIM']) {
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
    const ac = sim.aircraft, ind = sim.systems.ind, c = sim.controls, ap = sim.autopilot;
    this.top.innerHTML = `<strong>JETVAULT</strong> &nbsp;EGPH · ${ac.def.name.toUpperCase()} · ${view.toUpperCase()} VIEW · WEATHER ${sim.weather.source.toUpperCase()}`;
    if (this.visible) {
      const gs = Math.hypot(ac.vel.x, ac.vel.y) / KT;
      this.set('IAS', `${ind.iasKt.toFixed(0)} kt`, ind.stallHorn ? 'bad' : ind.iasKt > ac.def.limits.vno ? 'warn' : '');
      this.set('GS', `${gs.toFixed(0)} kt`);
      this.set('ALT', `${ind.altitudeFt.toFixed(0)} ft`);
      this.set('AGL', `${Math.max(0, (ac.agl - 1) / FT).toFixed(0)} ft`);
      this.set('V/S', `${(Math.round(ind.vsiFpm / 10) * 10).toFixed(0)}`);
      this.set('HDG', `${Math.round(ind.headingDeg).toString().padStart(3, '0')}°`);
      this.set('THR', `${(c.throttle * 100).toFixed(0)}%`);
      if (ac.def.turbofans) this.set('RPM', `N1 ${(ind.rpm / 100).toFixed(0)}%`, ind.rpm / 100 > 101 ? 'bad' : '');
      else this.set('RPM', ind.rpm.toFixed(0), ind.rpm > 2700 ? 'bad' : '');
      this.set('FLAPS', `${Math.round(ac.flap * RAD)}°${ac.def.retractableGear ? (ac.gearExt > 0.99 ? ' GR DN' : ac.gearExt > 0.01 ? ' GR TR' : ' GR UP') : ''}`, ac.flap > 0.01 ? 'on' : '');
      this.set('TRIM', `${c.trim >= 0 ? 'UP' : 'DN'} ${Math.abs(c.trim * 100).toFixed(0)}`);
      this.set('BRAKES', c.parkingBrake ? 'PARK' : c.brakeLeft > 0 || c.brakeRight > 0 ? 'ON' : 'OFF', c.parkingBrake ? 'warn' : '');
      this.set('AP', ap.engaged ? `${ap.lateral} ${ap.vertical}` : 'OFF', ap.engaged ? 'on' : '');
      this.set('SIM', sim.paused ? 'PAUSED' : `${sim.timeScale}x`, sim.paused ? 'warn' : '');
    }
    if (ac.crashed) {
      this.msg.innerHTML = `<div class="big">${ac.crashReason.toUpperCase()}</div><div class="small">Ctrl+R to restart at the same position · Esc for the menu</div>`;
    } else if (sim.paused) {
      this.msg.innerHTML = '<div class="big">PAUSED</div><div class="small">P to resume</div>';
    } else if (!ac.engine.running && ac.onGround && ac.vel.len() < 0.2 && sim.simTime < 20) {
      this.msg.innerHTML = '<div class="small">Engine off. Start it from the panel (master BAT, mixture rich, ignition to START) or press Ctrl+E for the automatic start sequence.</div>';
    } else {
      this.msg.innerHTML = '';
    }
  }
}
