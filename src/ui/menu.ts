// Main menu: Fly Now, World Map, Aircraft, Airports, Weather, Settings, Controls, About.
// Items that are not implemented yet are shown disabled and labelled as such.

import { SpawnKind } from '../sim/simulation';
import { WeatherSettings, CloudCover } from '../sim/weather';
import { Action, InputSettings, DEFAULT_BINDINGS, saveInputSettings } from '../input/input';
import { World } from '../world/world';
import { Aircraft, AircraftDef } from '../sim/fdm/aircraft';

export interface GraphicsSettings {
  renderScale: number;
  shadows: boolean;
  terrainDetail: number;
  buildingDistanceKm: number;
  clouds: boolean;
}

const GFX_STORE = 'jetvault.gfx.v1';
export function loadGraphics(): GraphicsSettings {
  const d: GraphicsSettings = { renderScale: 1, shadows: true, terrainDetail: 1, buildingDistanceKm: 12, clouds: true };
  try { const s = localStorage.getItem(GFX_STORE); if (s) return { ...d, ...JSON.parse(s) }; } catch { /* ignore */ }
  return d;
}
export function saveGraphics(g: GraphicsSettings) { try { localStorage.setItem(GFX_STORE, JSON.stringify(g)); } catch { /* ignore */ } }

export interface MenuHost {
  world: World;
  aircraft: Aircraft;
  weather: WeatherSettings;
  graphics: GraphicsSettings;
  inputSettings: InputSettings;
  payload: number[];
  fuelFraction: [number, number];
  aircraftDefs: AircraftDef[];
  selectAircraft(id: string): void;
  startView: 'cockpit' | 'chase';
  fly(spawn: SpawnKind | { kind: 'air'; east: number; north: number; altFt: number; hdg: number }): void;
  applyWeather(w: WeatherSettings): void;
  applyGraphics(g: GraphicsSettings): void;
  resume(): void;
  canResume(): boolean;
  attribution: string[];
}

type Tab = 'fly' | 'map' | 'aircraft' | 'airports' | 'planner' | 'weather' | 'settings' | 'controls' | 'training' | 'about';

const ACTION_LABELS: Partial<Record<Action, string>> = {
  pitchUp: 'Pitch up (pull)', pitchDown: 'Pitch down (push)', rollLeft: 'Roll left', rollRight: 'Roll right',
  yawLeft: 'Rudder left', yawRight: 'Rudder right', throttleUp: 'Throttle increase', throttleDown: 'Throttle decrease',
  throttleFull: 'Throttle full', throttleIdle: 'Throttle idle', mixtureRich: 'Mixture richer', mixtureLean: 'Mixture leaner',
  flapsUp: 'Flaps retract one notch', flapsDown: 'Flaps extend one notch', trimUp: 'Elevator trim nose up', trimDown: 'Elevator trim nose down',
  brakes: 'Brakes (both)', brakeLeft: 'Left brake', brakeRight: 'Right brake', parkingBrake: 'Parking brake',
  viewCockpit: 'Cockpit view', viewChase: 'Chase view', viewWing: 'Wing view', viewTower: 'Tower view', viewFree: 'Free camera (WASD/QE)',
  pause: 'Pause', simRate: 'Simulation rate 1x/2x/4x', menu: 'Menu', autoStart: 'Automatic engine start sequence',
  apToggle: 'Autopilot engage/disengage', apHdg: 'Autopilot HDG mode', apAlt: 'Autopilot ALT hold', apUp: 'Autopilot UP', apDown: 'Autopilot DN',
  gearToggle: 'Landing gear up/down (737)', speedbrake: 'Speedbrake extend/retract (737)', reverse: 'Thrust reversers (hold, on ground, 737)',
  hdgBugSync: 'Heading bug to current heading', debugCollision: 'Collision debug view + editor', perfOverlay: 'Performance overlay',
  hud: 'HUD on/off', mouseYoke: 'Mouse yoke on/off', reset: 'Restart flight', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
};

export class Menu {
  readonly el: HTMLDivElement;
  private section: HTMLElement;
  private tab: Tab = 'fly';
  private spawn: SpawnKind = { kind: 'stand', index: 0, coldAndDark: false };
  open = true;
  private mapCanvas: HTMLCanvasElement | null = null;
  private hillshade: ImageData | null = null;

  constructor(private host: MenuHost) {
    this.el = document.createElement('div');
    this.el.className = 'jv-menu';
    const nav = document.createElement('nav');
    nav.innerHTML = `<div class="jv-brand"><span class="jv-logo"></span>JETVAULT</div>`;
    const items: [Tab, string, boolean, string?][] = [
      ['fly', 'Fly', true],
    ];
    for (const [t, name, enabled, note] of items) {
      const b = document.createElement('button');
      b.innerHTML = `${name}${note ? `<small>${note}</small>` : ''}`;
      b.disabled = !enabled;
      b.dataset.tab = t;
      b.onclick = () => { this.tab = t; this.render(); };
      nav.appendChild(b);
    }
    const sp = document.createElement('div'); sp.className = 'spacer'; nav.appendChild(sp);
    this.section = document.createElement('section');
    this.el.append(nav, this.section);
    document.body.appendChild(this.el);
    this.render();
  }

  show() { this.open = true; this.el.style.display = ''; this.render(); }
  hide() { this.open = false; this.el.style.display = 'none'; }

  private render() {
    this.el.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === this.tab));
    const s = this.section;
    const h = this.host;
    s.innerHTML = '';
    if (this.tab === 'fly') this.renderFly(s);
    else if (this.tab === 'map') this.renderMap(s);
    else if (this.tab === 'aircraft') this.renderAircraft(s);
    else if (this.tab === 'airports') {
      s.innerHTML = `<h2>Airport Selection</h2><p>Edinburgh (EGPH) is the validated test region: real terrain (Copernicus DEM), land cover (ESA WorldCover),
      runway thresholds (OurAirports) and taxiways, aprons, stands and buildings (OpenStreetMap via Overture Maps).
      Further airports will be added once this region is fully validated.</p>
      <div class="jv-grid"><div class="jv-card sel"><b>EGPH Edinburgh</b><span>Runway 06/24 · 2556 m · asphalt<br>Elevation ${(h.world.airport.arp.elev / 0.3048).toFixed(0)} ft · TWR ${h.world.airport.frequencies.TWR} · GND ${h.world.airport.frequencies.GND}</span></div></div>`;
    } else if (this.tab === 'weather') this.renderWeather(s);
    else if (this.tab === 'settings') this.renderSettings(s);
    else if (this.tab === 'controls') this.renderControls(s);
    else if (this.tab === 'about') {
      s.innerHTML = `<h2>About JetVault Flight Simulator</h2>
      <p>Version 0.1 development build. A browser-based flight simulator with a six-degree-of-freedom flight model built from
      lifting-surface aerodynamics, a piston engine and propeller model, and spring-damper landing gear on real terrain.
      The Cessna 172S model is validated against its Pilot's Operating Handbook in an automated test suite.</p>
      <h3>Data and licences</h3><p>${h.attribution.map((a) => `${a}`).join('<br>')}</p>
      <p>All 3D models, textures and instrument artwork are original procedural assets created for JetVault.
      JetVault is not affiliated with Microsoft, Asobo, Textron Aviation or any airport operator.</p>`;
    }
  }

  private renderFly(s: HTMLElement) {
    const ap = this.host.world.airport;
    const def = this.host.aircraft.def;
    const jet = def.id === 'b738';
    s.innerHTML = `<h2>Fly Now</h2><p>Choose the aircraft, airport, start position and view.</p><h3>Aircraft</h3>`;
    this.aircraftPicker(s);
    s.insertAdjacentHTML('beforeend', `<h3>Airport</h3><div class="jv-grid"><div class="jv-card sel"><b>EGPH Edinburgh</b><span>Runway 06/24 · real terrain, taxiways and buildings</span></div></div><h3>Start position</h3>`);
    const grid = document.createElement('div'); grid.className = 'jv-grid';
    const opts: [SpawnKind, string, string][] = [
      ...(jet ? ap.standsJet ?? [] : ap.stands).map((_, i): [SpawnKind, string, string] => [{ kind: 'stand', index: i, coldAndDark: false }, `Parking stand ${i + 1}`, 'Apron, parking brake set']),
      [{ kind: 'runway', ident: '24' }, 'Runway 24', jet ? 'Lined up, engines running, flaps 5' : 'Lined up, engine running'],
      [{ kind: 'runway', ident: '06' }, 'Runway 06', jet ? 'Lined up, engines running, flaps 5' : 'Lined up, engine running'],
      [{ kind: 'approach', ident: '24', distanceNm: jet ? 6 : 3 }, 'Final approach 24', jet ? '6 nm, 3° glidepath, flaps 30, gear down' : '3 nm, 3° glidepath, flaps 10'],
      [{ kind: 'approach', ident: '06', distanceNm: jet ? 6 : 3 }, 'Final approach 06', jet ? '6 nm, 3° glidepath, flaps 30, gear down' : '3 nm, 3° glidepath, flaps 10'],
    ];
    const key = (k: SpawnKind) => JSON.stringify({ ...k, coldAndDark: undefined });
    for (const [k, t, d] of opts) {
      const c = document.createElement('div');
      c.className = 'jv-card' + (key(k) === key(this.spawn) ? ' sel' : '');
      c.innerHTML = `<b>${t}</b><span>${d}</span>`;
      c.onclick = () => { const cd = this.spawn.kind === 'stand' && this.spawn.coldAndDark; this.spawn = k.kind === 'stand' ? { ...k, coldAndDark: cd } : k; this.render(); };
      grid.appendChild(c);
    }
    s.appendChild(grid);
    const form = document.createElement('div');
    form.className = 'jv-form';
    form.style.marginTop = '18px';
    form.innerHTML = `<label>Start view</label><select id="sv"><option value="cockpit" ${this.host.startView === 'cockpit' ? 'selected' : ''}>Cockpit</option><option value="chase" ${this.host.startView === 'chase' ? 'selected' : ''}>External (chase)</option></select><span></span>`;
    form.querySelector('#sv')!.addEventListener('change', (e) => { this.host.startView = (e.target as HTMLSelectElement).value as 'cockpit' | 'chase'; });
    s.appendChild(form);
    const act = document.createElement('div'); act.className = 'jv-actions';
    const fly = document.createElement('button'); fly.className = 'jv-btn'; fly.textContent = 'FLY';
    fly.onclick = () => this.host.fly(this.spawn);
    act.appendChild(fly);
    if (this.host.canResume()) {
      const r = document.createElement('button'); r.className = 'jv-btn ghost'; r.textContent = 'RESUME FLIGHT';
      r.onclick = () => this.host.resume();
      act.appendChild(r);
    }
    s.appendChild(act);
    const help = document.createElement('p');
    help.innerHTML = 'Controls: mouse = fly (move from the centre of the screen) · 1-9 = throttle (1 idle, 9 full) · Left/Right arrows = rudder · Space = brakes · F = flaps (cycles) · G = gear · B = spoilers · C = cockpit/outside view · mouse wheel = zoom · Esc = menu. On phones and tablets: joystick on the left, throttle slider on the right, buttons for the rest.';
    s.appendChild(help);
  }

  private renderMap(s: HTMLElement) {
    s.innerHTML = `<h2>World Map</h2><p>Edinburgh region, 48 x 48 km high-resolution terrain. Click the map to start airborne at that position (2,500 ft, heading toward EGPH).</p>`;
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 800; cv.className = 'jv-map';
    s.appendChild(cv);
    this.mapCanvas = cv;
    this.drawMap();
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      const grid = this.host.world.terrain.hi;
      const east = ((e.clientX - r.left) / r.width) * 2 * grid.half - grid.half;
      const north = grid.half - ((e.clientY - r.top) / r.height) * 2 * grid.half;
      const hdg = Math.atan2(-east, -north);
      this.host.fly({ kind: 'air', east, north, altFt: 2500, hdg });
    };
  }

  drawMap() {
    const cv = this.mapCanvas;
    if (!cv || !cv.isConnected) return;
    const g = cv.getContext('2d')!;
    const grid = this.host.world.terrain.hi;
    const W = cv.width;
    if (!this.hillshade) {
      const img = g.createImageData(W, W);
      const lc = this.host.world.landcover;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const e = -grid.half + (x / W) * 2 * grid.half, n = grid.half - (y / W) * 2 * grid.half;
        const nrm = { e: 0, n: 0, u: 1 };
        const h = grid.sample(e, n, nrm);
        const shade = Math.max(0, -nrm.e * 0.5 + nrm.n * 0.5 + nrm.u * 0.7);
        const cls = lc ? lc.at(e, n) : 30;
        let col = cls === 80 ? [22, 40, 66] : cls === 50 ? [70, 72, 80] : cls === 10 ? [34, 56, 40] : [52, 70, 48];
        if (h > 250) col = [70, 66, 56];
        const k = cls === 80 ? 1 : 0.55 + 0.6 * shade;
        const i = (y * W + x) * 4;
        img.data[i] = col[0] * k; img.data[i + 1] = col[1] * k; img.data[i + 2] = col[2] * k; img.data[i + 3] = 255;
      }
      this.hillshade = img;
    }
    g.putImageData(this.hillshade, 0, 0);
    const P = (e: number, n: number): [number, number] => [((e + grid.half) / (2 * grid.half)) * W, ((grid.half - n) / (2 * grid.half)) * W];
    g.strokeStyle = '#e9edf3'; g.lineWidth = 3;
    for (const rw of this.host.world.airport.runways) { g.beginPath(); g.moveTo(...P(rw.ends[0].x, rw.ends[0].y)); g.lineTo(...P(rw.ends[1].x, rw.ends[1].y)); g.stroke(); }
    g.fillStyle = '#e9edf3'; g.font = '12px sans-serif'; g.fillText('EGPH', ...P(250, -500));
    const ac = this.host.aircraft;
    const [x, y] = P(ac.pos.y, ac.pos.x);
    const psi = ac.euler[2];
    g.save(); g.translate(x, y); g.rotate(psi);
    g.fillStyle = '#4f8ef7'; g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 8); g.lineTo(0, 4); g.lineTo(-6, 8); g.closePath(); g.fill();
    g.restore();
  }

  /** Aircraft cards with a planform preview drawn from the flight-model geometry. */
  private aircraftPicker(s: HTMLElement) {
    const grid = document.createElement('div'); grid.className = 'jv-grid';
    const blurb: Record<string, string> = {
      c172s: 'Lycoming IO-360 180 hp · fixed-pitch prop · steam gauges · validated against the POH',
      b738: '2 x CFM56-7B26 (117 kN) · glass PFD/ND · flaps, slats, spoilers, reversers, retractable gear',
    };
    for (const d of this.host.aircraftDefs) {
      const c = document.createElement('div');
      c.className = 'jv-card' + (d.id === this.host.aircraft.def.id ? ' sel' : '');
      const cv = document.createElement('canvas'); cv.width = 260; cv.height = 150; cv.style.width = '100%';
      drawPlanform(cv, d);
      c.appendChild(cv);
      c.insertAdjacentHTML('beforeend', `<b>${d.name}</b><span>${blurb[d.id] ?? ''}<br>MTOW ${d.maxTakeoffMass.toLocaleString()} kg · span ${d.wingSpan} m</span>`);
      c.onclick = () => { this.host.selectAircraft(d.id); this.spawn = { kind: 'stand', index: 0, coldAndDark: false }; this.render(); };
      grid.appendChild(c);
    }
    grid.insertAdjacentHTML('beforeend', `<div class="jv-card" style="opacity:.45;cursor:default"><b>Airbus A320</b><span>Planned</span></div>`);
    s.appendChild(grid);
  }

  private renderAircraft(s: HTMLElement) {
    const ac = this.host.aircraft;
    const d = ac.def;
    s.innerHTML = `<h2>Aircraft Selection</h2>`;
    this.aircraftPicker(s);
    s.insertAdjacentHTML('beforeend', `<h3>Weight and balance (applied on the next start)</h3>`);
    const form = document.createElement('div'); form.className = 'jv-form';
    const out = document.createElement('div');
    const upd = () => {
      let m = d.emptyMass, mx = d.emptyCG.x * d.emptyMass;
      d.stations.forEach((st, i) => { m += this.host.payload[i]; mx += st.pos.x * this.host.payload[i]; });
      d.tanks.forEach((t, i) => { const f = t.capacity * this.host.fuelFraction[i]; m += f; mx += t.pos.x * f; });
      const cg = mx / m;
      const wing = d.surfaces.filter((q) => q.role === 'wing');
      const qc = wing.reduce((a, q) => a + q.pos.x * q.area, 0) / wing.reduce((a, q) => a + q.area, 0);
      const macLE = qc + 0.25 * d.mac; // area-weighted quarter chord + 25 % MAC
      const pct = ((macLE - cg) / d.mac) * 100;
      out.innerHTML = `<p>Total mass <b style="color:${m > d.maxTakeoffMass ? 'var(--danger)' : 'var(--text)'}">${m.toFixed(0)} kg (${(m / 0.4536).toFixed(0)} lb)</b>
        ${m > d.maxTakeoffMass ? ' — above maximum take-off mass' : ''} · CG ${pct.toFixed(0)} % MAC</p>`;
    };
    d.stations.forEach((st, i) => {
      form.insertAdjacentHTML('beforeend', `<label>${st.name}</label><input type="range" min="0" max="${st.max}" step="1" value="${this.host.payload[i]}" data-st="${i}"><span class="val">${this.host.payload[i]} kg</span>`);
    });
    d.tanks.forEach((t, i) => {
      form.insertAdjacentHTML('beforeend', `<label>Fuel ${t.name} tank</label><input type="range" min="0" max="1" step="0.01" value="${this.host.fuelFraction[i]}" data-tk="${i}"><span class="val">${(t.capacity * this.host.fuelFraction[i] / 0.72 / 3.785).toFixed(1)} gal</span>`);
    });
    form.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const v = parseFloat(t.value);
      const span = t.nextElementSibling as HTMLElement;
      if (t.dataset.st) { this.host.payload[Number(t.dataset.st)] = v; span.textContent = `${v} kg`; }
      if (t.dataset.tk) { const i = Number(t.dataset.tk); this.host.fuelFraction[i] = v; span.textContent = `${(d.tanks[i].capacity * v / 0.72 / 3.785).toFixed(1)} gal`; }
      upd();
    });
    s.append(form, out);
    upd();
  }

  private renderWeather(s: HTMLElement) {
    const w = { ...this.host.weather };
    s.innerHTML = `<h2>Weather</h2><p>Source: <b>manual</b>. Live METAR is not connected yet; all values below are user-set.
      Wind, gusts, turbulence, temperature and pressure act on the flight model; cloud, visibility and rain are visual (rain also wets the runway).</p>`;
    const form = document.createElement('div'); form.className = 'jv-form';
    const range = (k: keyof WeatherSettings, label: string, min: number, max: number, step: number, unit: string) => {
      form.insertAdjacentHTML('beforeend', `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${w[k]}" data-k="${k}"><span class="val">${w[k]} ${unit}</span>`);
    };
    range('windDirection', 'Wind direction (from, true)', 0, 359, 1, '°');
    range('windSpeed', 'Wind speed', 0, 40, 1, 'kt');
    range('gustSpeed', 'Gusts to', 0, 50, 1, 'kt');
    range('turbulence', 'Turbulence', 0, 1, 0.05, '');
    range('visibility', 'Visibility', 200, 60000, 100, 'm');
    form.insertAdjacentHTML('beforeend', `<label>Cloud cover</label><select data-k="cloudCover">${(['SKC', 'FEW', 'SCT', 'BKN', 'OVC'] as CloudCover[]).map((c) => `<option ${c === w.cloudCover ? 'selected' : ''}>${c}</option>`).join('')}</select><span></span>`);
    range('cloudBaseFt', 'Cloud base', 500, 10000, 100, 'ft');
    range('temperatureC', 'Temperature (field)', -20, 35, 1, '°C');
    range('qnh', 'QNH', 960, 1050, 1, 'hPa');
    range('rain', 'Rain', 0, 1, 0.05, '');
    range('timeOfDay', 'Time (UTC)', 0, 23.75, 0.25, 'h');
    range('dayOfYear', 'Day of year', 1, 365, 1, '');
    form.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.dataset.k as keyof WeatherSettings;
      (w as any)[k] = t.tagName === 'SELECT' ? t.value : parseFloat(t.value);
      const span = t.nextElementSibling as HTMLElement;
      if (span && t.tagName !== 'SELECT') span.textContent = `${t.value} ${span.textContent!.split(' ').slice(1).join(' ')}`;
    });
    s.appendChild(form);
    const act = document.createElement('div'); act.className = 'jv-actions';
    const ap = document.createElement('button'); ap.className = 'jv-btn'; ap.textContent = 'APPLY';
    ap.onclick = () => this.host.applyWeather({ ...w, source: 'manual' });
    const presets: [string, Partial<WeatherSettings>][] = [
      ['Clear day', { windSpeed: 5, gustSpeed: 0, turbulence: 0.1, visibility: 50000, cloudCover: 'FEW', rain: 0, timeOfDay: 13 }],
      ['Scottish showers', { windDirection: 250, windSpeed: 16, gustSpeed: 26, turbulence: 0.45, visibility: 8000, cloudCover: 'BKN', cloudBaseFt: 1800, rain: 0.5 }],
      ['Low cloud and fog', { windSpeed: 3, gustSpeed: 0, turbulence: 0.05, visibility: 800, cloudCover: 'OVC', cloudBaseFt: 600, rain: 0.1 }],
      ['Night', { timeOfDay: 23, cloudCover: 'FEW', visibility: 30000, rain: 0 }],
    ];
    act.appendChild(ap);
    for (const [name, p] of presets) {
      const b = document.createElement('button'); b.className = 'jv-btn ghost'; b.textContent = name.toUpperCase();
      b.onclick = () => { Object.assign(w, p); this.host.applyWeather({ ...w, source: 'manual' }); this.render(); };
      act.appendChild(b);
    }
    s.appendChild(act);
  }

  private renderSettings(s: HTMLElement) {
    const g = { ...this.host.graphics };
    const inp = this.host.inputSettings;
    s.innerHTML = `<h2>Settings</h2><h3>Graphics</h3>`;
    const f = document.createElement('div'); f.className = 'jv-form';
    f.innerHTML = `
      <label>Render scale</label><input type="range" min="0.4" max="1" step="0.05" value="${g.renderScale}" data-g="renderScale"><span class="val">${g.renderScale}</span>
      <label>Shadows</label><input type="checkbox" data-g="shadows" ${g.shadows ? 'checked' : ''}><span></span>
      <label>Clouds</label><input type="checkbox" data-g="clouds" ${g.clouds ? 'checked' : ''}><span></span>
      <label>Terrain detail</label><input type="range" min="0.5" max="2" step="0.1" value="${g.terrainDetail}" data-g="terrainDetail"><span class="val">${g.terrainDetail}</span>
      <label>Building draw distance</label><input type="range" min="2" max="24" step="1" value="${g.buildingDistanceKm}" data-g="buildingDistanceKm"><span class="val">${g.buildingDistanceKm} km</span>`;
    f.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.dataset.g as keyof GraphicsSettings;
      (g as any)[k] = t.type === 'checkbox' ? t.checked : parseFloat(t.value);
      if (t.nextElementSibling && t.type !== 'checkbox') t.nextElementSibling.textContent = t.value;
      this.host.applyGraphics(g);
      saveGraphics(g);
    });
    s.appendChild(f);
    s.insertAdjacentHTML('beforeend', '<h3>Controls</h3>');
    const c = document.createElement('div'); c.className = 'jv-form';
    c.innerHTML = `
      <label>Keyboard control rate</label><input type="range" min="0.5" max="4" step="0.1" value="${inp.keyRate}" data-i="keyRate"><span class="val">${inp.keyRate}</span>
      <label>Controller dead zone</label><input type="range" min="0" max="0.3" step="0.01" value="${inp.deadZone}" data-i="deadZone"><span class="val">${inp.deadZone}</span>
      <label>Controller response curve</label><input type="range" min="1" max="3" step="0.1" value="${inp.curve}" data-i="curve"><span class="val">${inp.curve}</span>
      <label>Invert pitch axis</label><input type="checkbox" data-i="invertPitch" ${inp.invertPitch ? 'checked' : ''}><span></span>
      <label>Beginner mode: auto-rudder</label><input type="checkbox" data-i="autoRudder" ${inp.autoRudder ? 'checked' : ''}><span class="jv-dim">Moves the pedals: coordinates turns, holds heading on the ground</span>
      <label>Beginner mode: auto-trim</label><input type="checkbox" data-i="autoTrim" ${inp.autoTrim ? 'checked' : ''}><span class="jv-dim">Holds level flight / vertical speed when you release the stick (moves the trim)</span>
      <label>Axis: pitch / roll / yaw / throttle</label><input type="text" data-i="axes" value="${inp.axes.pitch},${inp.axes.roll},${inp.axes.yaw},${inp.axes.throttle}"><span class="jv-dim">Gamepad API axis indices for your joystick or yoke</span>`;
    c.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.dataset.i!;
      if (k === 'axes') {
        const v = t.value.split(',').map(Number);
        if (v.length === 4 && v.every((x) => Number.isInteger(x) && x >= 0)) inp.axes = { pitch: v[0], roll: v[1], yaw: v[2], throttle: v[3] };
      } else (inp as any)[k] = t.type === 'checkbox' ? t.checked : parseFloat(t.value);
      if (t.nextElementSibling && t.type === 'range') t.nextElementSibling.textContent = t.value;
      saveInputSettings(inp);
    });
    s.appendChild(c);
  }

  private renderControls(s: HTMLElement) {
    const inp = this.host.inputSettings;
    s.innerHTML = `<h2>Controls</h2><p>Click a key to rebind it, then press the new key (Esc cancels). Bindings are saved in this browser.
      Joysticks, yokes and game controllers are read through the browser Gamepad API (press a button on the device once to activate it).
      Mouse: drag to look around; click switches, knobs and buttons on the instrument panel; mouse wheel over a knob turns it.</p>`;
    const t = document.createElement('table'); t.className = 'jv-keys';
    for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${ACTION_LABELS[a] ?? a}</td><td>${inp.bindings[a].map((k, i) => `<kbd data-a="${a}" data-i="${i}">${k.replace('Key', '').replace('Digit', '')}</kbd>`).join('')}</td>`;
      t.appendChild(tr);
    }
    t.addEventListener('click', (e) => {
      const k = e.target as HTMLElement;
      if (k.tagName !== 'KBD') return;
      k.classList.add('listen'); k.textContent = '...';
      const on = (ev: KeyboardEvent) => {
        ev.preventDefault(); ev.stopPropagation();
        window.removeEventListener('keydown', on, true);
        if (ev.code !== 'Escape') {
          const code = `${ev.ctrlKey ? 'Ctrl+' : ''}${ev.shiftKey && !ev.code.startsWith('Shift') ? 'Shift+' : ''}${ev.code}`;
          inp.bindings[k.dataset.a as Action][Number(k.dataset.i)] = code;
          saveInputSettings(inp);
        }
        this.render();
      };
      window.addEventListener('keydown', on, true);
    });
    s.appendChild(t);
    const reset = document.createElement('button'); reset.className = 'jv-btn ghost'; reset.textContent = 'RESET TO DEFAULTS';
    reset.style.marginTop = '20px';
    reset.onclick = () => { inp.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); saveInputSettings(inp); this.render(); };
    s.appendChild(reset);
  }
}

/** Top view drawn from the aerodynamic surfaces and gear of the flight model. */
function drawPlanform(cv: HTMLCanvasElement, d: AircraftDef) {
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0d1626'; g.fillRect(0, 0, cv.width, cv.height);
  const xs = d.surfaces.map((q) => q.pos.x).concat(d.hullPoints.map((p) => p.x));
  const span = d.wingSpan + 1;
  const len = Math.max(...xs) - Math.min(...xs) + 2;
  const k = Math.min((cv.width - 20) / span, (cv.height - 20) / len);
  const cx = cv.width / 2, cy = cv.height / 2 + ((Math.max(...xs) + Math.min(...xs)) / 2) * k;
  g.fillStyle = '#c9d3e3';
  for (const q of d.surfaces) {
    if (q.role === 'vtail') continue;
    const halfSpan = q.area / q.chord / 2;
    g.fillRect(cx + q.pos.y * k - halfSpan * k, cy - (q.pos.x + q.chord * 0.25) * k, halfSpan * 2 * k, q.chord * k);
  }
  g.fillStyle = '#e9edf3';
  const nose = Math.max(...xs), tail = Math.min(...xs);
  const fw = d.id === 'b738' ? 3.76 : 1.15;
  g.beginPath(); g.ellipse(cx, cy - ((nose + tail) / 2) * k, (fw / 2) * k, ((nose - tail) / 2) * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#4f8ef7';
  for (const t of d.turbofans ?? []) g.fillRect(cx + t.pos.y * k - 1.0 * k, cy - (t.pos.x + 2.5) * k, 2.0 * k, 4.5 * k);
}
