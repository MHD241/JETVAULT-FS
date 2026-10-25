// Main menu: Fly Now, World Map, Aircraft, Airports, Weather, Settings, Controls, About.
// Items that are not implemented yet are shown disabled and labelled as such.

import { SpawnKind } from '../sim/simulation';
import { WeatherSettings, CloudCover } from '../sim/weather';
import { InputSettings, saveInputSettings } from '../input/input';
import { airportCentre } from '../world/airport';
import { World } from '../world/world';
import { Aircraft, AircraftDef } from '../sim/fdm/aircraft';

export interface GraphicsSettings {
  renderScale: number;
  shadows: boolean;
  terrainDetail: number;
  buildingDistanceKm: number;
  clouds: boolean;
  /** Sun shadow map size (px) and whether shadow edges are softened (PCF soft). */
  shadowSize: number;
  softShadows: boolean;
}

export type GraphicsPreset = 'low' | 'high' | 'ultra';
/** Graphics presets. LOW favours frame rate (phones); HIGH is the default; ULTRA spends more GPU on shadows, terrain and draw distance. */
export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsSettings> = {
  low: { renderScale: 0.7, shadows: false, terrainDetail: 0.7, buildingDistanceKm: 6, clouds: true, shadowSize: 1024, softShadows: false },
  high: { renderScale: 1, shadows: true, terrainDetail: 1, buildingDistanceKm: 12, clouds: true, shadowSize: 2048, softShadows: true },
  ultra: { renderScale: 1, shadows: true, terrainDetail: 1.5, buildingDistanceKm: 20, clouds: true, shadowSize: 4096, softShadows: true },
};

const GFX_STORE = 'jetvault.gfx.v1';
export function loadGraphics(): GraphicsSettings {
  const d: GraphicsSettings = { ...GRAPHICS_PRESETS.high };
  try { const s = localStorage.getItem(GFX_STORE); if (s) return { ...d, ...JSON.parse(s) }; } catch { /* ignore */ }
  return d;
}
export function saveGraphics(g: GraphicsSettings) { try { localStorage.setItem(GFX_STORE, JSON.stringify(g)); } catch { /* ignore */ } }

export type AirSpawn = { kind: 'air'; east: number; north: number; altFt: number; hdg: number };
export type AnySpawn = SpawnKind | AirSpawn;

export interface MenuHost {
  /** GeoFS-style forgiving handling (wings self-level). */
  arcade: boolean;
  setArcade(on: boolean): void;
  world: World;
  aircraft: Aircraft;
  weather: WeatherSettings;
  graphics: GraphicsSettings;
  inputSettings: InputSettings;
  payload: number[];
  fuelFraction: [number, number];
  aircraftDefs: AircraftDef[];
  selectAircraft(id: string): void;
  airportChanged(): Promise<void>;
  startView: 'cockpit' | 'chase';
  fly(spawn: AnySpawn): Promise<void> | void;
  applyWeather(w: WeatherSettings): void;
  applyGraphics(g: GraphicsSettings): void;
  resume(): void;
  canResume(): boolean;
  attribution: string[];
}

type Tab = 'fly' | 'map' | 'aircraft' | 'airports' | 'planner' | 'weather' | 'settings' | 'controls' | 'training' | 'about';


export class Menu {
  readonly el: HTMLDivElement;
  private section: HTMLElement;
  private tab: Tab = 'fly';
  private spawn: AnySpawn = { kind: 'stand', index: 0, coldAndDark: false };
  open = true;
  private mapCanvas: HTMLCanvasElement | null = null;
  private hillshade: ImageData | null = null;

  constructor(private host: MenuHost) {
    this.el = document.createElement('div');
    this.el.className = 'jv-menu';
    const nav = document.createElement('nav');
    nav.innerHTML = `<div class="jv-brand"><span class="jv-logo"></span>JETVAULT</div>`;
    const items: [Tab, string, boolean, string?][] = [
      ['fly', 'Fly Now', true], ['map', 'World Map', true], ['aircraft', 'Aircraft Selection', true],
      ['airports', 'Airport Selection', true], ['planner', 'Flight Planner', false, 'Not yet available'],
      ['weather', 'Weather', true], ['settings', 'Settings', true], ['controls', 'Controls', true],
      ['training', 'Training', false, 'Not yet available'], ['about', 'About JetVault', true],
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
      s.innerHTML = `<h2>Airport Selection</h2><p>Scotland is one continuous map: Copernicus terrain and land cover everywhere, with full detail (satellite imagery, roads, buildings, airfield) around Edinburgh, Glasgow and Portmoak. Pick where you start; you can fly between them.</p>`;
      const grid = document.createElement('div'); grid.className = 'jv-grid';
      for (const a of h.world.airports) {
        const c = document.createElement('div');
        c.className = 'jv-card' + (a.icao === h.world.airport.icao ? ' sel' : '');
        c.innerHTML = `<b>${a.icao} ${a.name}</b><span>${a.runways.map((r) => `Runway ${r.id} · ${Math.round(r.length)} m · ${r.surface}`).join('<br>')}<br>Elevation ${(a.arp.elev / 0.3048).toFixed(0)} ft</span>`;
        c.onclick = () => { h.world.setAirport(a.icao); this.spawn = { kind: 'stand', index: 0, coldAndDark: false }; c.style.opacity = '0.6'; void this.host.airportChanged().then(() => this.render()); };
        grid.appendChild(c);
      }
      s.appendChild(grid);
    } else if (this.tab === 'weather') this.renderWeather(s);
    else if (this.tab === 'settings') this.renderSettings(s);
    else if (this.tab === 'controls') this.renderControls(s);
    else if (this.tab === 'about') {
      s.innerHTML = `<h2>About JetVault Flight Simulator</h2>
      <p>Version 0.1 development build. A browser-based flight simulator with a six-degree-of-freedom flight model built from
      lifting-surface aerodynamics, a piston engine and propeller model, and spring-damper landing gear on real terrain.
      The Cessna 172S model is validated against its Pilot's Operating Handbook in an automated test suite.</p>
      <h3>Data and licences</h3><p>${h.attribution.map((a) => `${a}`).join('<br>')}</p>
      <p>The 737-800 exterior mesh was supplied by the project owner as a free-to-use public model; its author and licence terms are NOT yet verified, and its original airline livery has been recoloured to a neutral scheme. All other 3D models, textures and instrument artwork are original procedural assets created for JetVault.
      JetVault is not affiliated with Microsoft, Asobo, Textron Aviation or any airport operator.</p>`;
    }
  }

  private renderFly(s: HTMLElement) {
    const ap = this.host.world.airport;
    const def = this.host.aircraft.def;
    const jet = def.id === 'b738';
    const glider = !!def.glider;
    s.innerHTML = `<h2>Fly Now</h2><p>Choose the aircraft, airport, start position and view.</p><h3>Aircraft</h3>`;
    this.aircraftPicker(s);
    s.insertAdjacentHTML('beforeend', `<h3>Airport</h3><div class="jv-grid"><div class="jv-card sel"><b>${ap.icao} ${ap.name}</b><span>${ap.runways.map((r) => `Runway ${r.id}`).join(', ')}<br>Change it under Airport Selection.</span></div></div><h3>Start position</h3>`);
    const idents = ap.runways.flatMap((r) => r.ends.map((e) => e.ident));
    const ctr = airportCentre(ap);
    const grid = document.createElement('div'); grid.className = 'jv-grid';
    const ridge = ap.icao === 'EGPM';
    const opts: [AnySpawn, string, string][] = glider ? [
      ...idents.map((id): [AnySpawn, string, string] => [{ kind: 'runway', ident: id }, `Runway ${id} winch launch`, 'On the ground, press LAUNCH for a winch launch (1,400 m cable)']),
      ridge
        ? [{ kind: 'air', east: ctr.x + 1000, north: ctr.y + 1700, altFt: 1500, hdg: 0 }, 'Airborne at the Lomond Hills ridge', 'Ridge soaring: best with a southerly wind (set it under Weather)']
        : [{ kind: 'air', east: ctr.x, north: ctr.y, altFt: 3000, hdg: 0 }, 'Airborne, 3,000 ft over the airport', 'Soaring: thermals by day, ridge lift in wind over hills'],
      [{ kind: 'approach', ident: idents[0], distanceNm: 1.5 }, `Final approach ${idents[0]}`, '1.5 nm final, airbrakes ready'],
    ] : [
      ...(jet ? ap.standsJet ?? [] : ap.stands).map((_, i): [AnySpawn, string, string] => [{ kind: 'stand', index: i, coldAndDark: false }, jet ? `Gate stand ${i + 1}` : `Parking stand ${i + 1}`, jet ? 'Nose-in at a boarding bridge, parking brake set' : 'Apron, parking brake set']),
      ...idents.map((id): [AnySpawn, string, string] => [{ kind: 'runway', ident: id }, `Runway ${id}`, jet ? 'Lined up, engines running, flaps 5' : 'Lined up, engine running']),
      ...idents.slice(0, 2).map((id): [AnySpawn, string, string] => [{ kind: 'approach', ident: id, distanceNm: jet ? 6 : 3 }, `Final approach ${id}`, jet ? '6 nm, 3° glidepath, flaps 30, gear down' : '3 nm, 3° glidepath, flaps 10']),
    ];
    const key = (k: AnySpawn) => JSON.stringify({ ...k, coldAndDark: undefined });
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
    help.innerHTML = 'Controls: mouse = fly, inverted (move from the centre of the screen; mouse up = nose down) · 1-9 = throttle (1 idle, 9 full) · Left/Right arrows = rudder · Space = brakes · F = flaps (cycles) · G = gear · B = spoilers · J = jet bridge (when parked at a gate) · K = parking brake · U = pushback · gliders: L/R = winch launch / release cable, V = vario sound · C = cockpit/outside view · mouse wheel / pinch = zoom · right-drag or two-finger scroll = look · Esc = menu. On phones and tablets: joystick on the left, throttle slider on the right, buttons for the rest.';
    s.appendChild(help);
  }

  private renderMap(s: HTMLElement) {
    const lo = this.host.world.terrain.lo!;
    s.innerHTML = `<h2>World Map</h2><p>Scotland, ${lo.half * 2 / 1000} x ${lo.half * 2 / 1000} km (terrain at ${lo.step} m, the ground gets coarser the higher you fly). Click the map to start airborne at that position. Airports with full detail: ${this.host.world.airports.map((a) => a.icao).join(', ')}.</p>`;
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 800; cv.className = 'jv-map';
    s.appendChild(cv);
    this.mapCanvas = cv;
    this.drawMap();
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      const east = ((e.clientX - r.left) / r.width) * 2 * lo.half - lo.half;
      const north = lo.half - ((e.clientY - r.top) / r.height) * 2 * lo.half;
      const ground = this.host.world.terrain.heightAt(east, north);
      this.host.fly({ kind: 'air', east, north, altFt: Math.max(2500, Math.round((ground / 0.3048 + 2000) / 100) * 100), hdg: 0 });
    };
  }

  drawMap() {
    const cv = this.mapCanvas;
    if (!cv || !cv.isConnected) return;
    const g = cv.getContext('2d')!;
    const grid = this.host.world.terrain.lo!;
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
        let col = cls === 80 ? [22, 40, 66] : cls === 50 ? [95, 90, 100] : cls === 10 ? [34, 56, 40] : [52, 70, 48];
        if (h > 600) col = [110, 104, 96]; else if (h > 250) col = [70, 66, 56];
        const k = cls === 80 ? 1 : 0.55 + 0.9 * shade;
        const i = (y * W + x) * 4;
        img.data[i] = Math.min(255, col[0] * k); img.data[i + 1] = Math.min(255, col[1] * k); img.data[i + 2] = Math.min(255, col[2] * k); img.data[i + 3] = 255;
      }
      this.hillshade = img;
    }
    g.putImageData(this.hillshade, 0, 0);
    const P = (e: number, n: number): [number, number] => [((e + grid.half) / (2 * grid.half)) * W, ((grid.half - n) / (2 * grid.half)) * W];
    g.font = '12px sans-serif';
    for (const a of this.host.world.airports) {
      const c = airportCentre(a);
      const [px, py] = P(c.x, c.y);
      g.fillStyle = a.icao === this.host.world.airport.icao ? '#f7c74f' : '#e9edf3';
      g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill();
      g.fillText(a.icao, px + 7, py + 4);
    }
    const ac = this.host.aircraft;
    const [x, y] = P(ac.pos.y, ac.pos.x);
    const psi = ac.euler[2];
    g.save(); g.translate(x, y); g.rotate(psi);
    g.fillStyle = '#4f8ef7'; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 8); g.lineTo(0, 4); g.lineTo(-6, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  /** Aircraft cards with a planform preview drawn from the flight-model geometry. */
  private aircraftPicker(s: HTMLElement) {
    const grid = document.createElement('div'); grid.className = 'jv-grid';
    const blurb: Record<string, string> = {
      c172s: 'Lycoming IO-360 180 hp · fixed-pitch prop · steam gauges · validated against the POH',
      glider: 'Unpowered 17 m two-seater, ~32:1 glide · winch launch · thermals and ridge lift · airbrakes',
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
    const pr = document.createElement('div'); pr.className = 'jv-actions';
    for (const k of ['low', 'high', 'ultra'] as GraphicsPreset[]) {
      const b = document.createElement('button'); b.textContent = k.toUpperCase();
      b.addEventListener('click', () => { const p = { ...GRAPHICS_PRESETS[k] }; this.host.applyGraphics(p); saveGraphics(p); this.renderSettings(s); });
      pr.appendChild(b);
    }
    s.appendChild(pr);
    const f = document.createElement('div'); f.className = 'jv-form';
    f.innerHTML = `
      <label>Render scale</label><input type="range" min="0.4" max="1" step="0.05" value="${g.renderScale}" data-g="renderScale"><span class="val">${g.renderScale}</span>
      <label>Shadows</label><input type="checkbox" data-g="shadows" ${g.shadows ? 'checked' : ''}><span></span>
      <label>Soft shadow edges</label><input type="checkbox" data-g="softShadows" ${g.softShadows ? 'checked' : ''}><span></span>
      <label>Shadow map size</label><input type="range" min="1024" max="4096" step="1024" value="${g.shadowSize}" data-g="shadowSize"><span class="val">${g.shadowSize}</span>
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
      <label>Easy flying (GeoFS-style)</label><input type="checkbox" data-arcade ${this.host.arcade ? 'checked' : ''}><span class="jv-dim">Wings level themselves when you release the stick; auto-trim already holds your pitch. Physics unchanged</span>
      <label>Invert pitch axis</label><input type="checkbox" data-i="invertPitch" ${inp.invertPitch ? 'checked' : ''}><span></span>
      <label>Beginner mode: auto-rudder</label><input type="checkbox" data-i="autoRudder" ${inp.autoRudder ? 'checked' : ''}><span class="jv-dim">Moves the pedals: coordinates turns, holds heading on the ground</span>
      <label>Beginner mode: auto-trim</label><input type="checkbox" data-i="autoTrim" ${inp.autoTrim ? 'checked' : ''}><span class="jv-dim">Holds level flight / vertical speed when you release the stick (moves the trim)</span>
      <label>Axis: pitch / roll / yaw / throttle</label><input type="text" data-i="axes" value="${inp.axes.pitch},${inp.axes.roll},${inp.axes.yaw},${inp.axes.throttle}"><span class="jv-dim">Gamepad API axis indices for your joystick or yoke</span>`;
    c.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.hasAttribute('data-arcade')) { this.host.setArcade(t.checked); return; }
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
    s.innerHTML = `<h2>Controls</h2><p>The controls are fixed to a simple scheme (no rebinding).</p>
    <h3>Keyboard and mouse</h3><table class="jv-keys">
    <tr><td>Fly (pitch / roll)</td><td>Mouse, from the centre of the screen. Pitch is inverted: mouse up = nose down. On the ground it steers.</td></tr>
    <tr><td>Throttle</td><td><kbd>1</kbd> idle ... <kbd>9</kbd> full (jets and piston); in the tug, <kbd>1</kbd> = stop, <kbd>9</kbd> = fastest</td></tr>
    <tr><td>Rudder / steering</td><td><kbd>&larr;</kbd> <kbd>&rarr;</kbd></td></tr>
    <tr><td>Brakes (hold)</td><td><kbd>Space</kbd></td></tr>
    <tr><td>Parking brake</td><td><kbd>K</kbd> or the PARK BRAKE button</td></tr>
    <tr><td>Flaps (cycle)</td><td><kbd>F</kbd></td></tr>
    <tr><td>Gear</td><td><kbd>G</kbd></td></tr>
    <tr><td>Spoilers / airbrakes</td><td><kbd>B</kbd></td></tr>
    <tr><td>View: cockpit / outside</td><td><kbd>C</kbd></td></tr>
    <tr><td>Camera</td><td>Mouse wheel or trackpad pinch = zoom; hold the right mouse button and move, or two-finger scroll on a trackpad = look/orbit; swipe on touch screens</td></tr>
    <tr><td>Jet bridge (at a gate)</td><td><kbd>J</kbd></td></tr>
    <tr><td>Pushback (airliner at a gate)</td><td><kbd>U</kbd>; <kbd>X</kbd> or <kbd>&uarr;</kbd> centres the tug wheel</td></tr>
    <tr><td>Glider winch launch / release</td><td><kbd>L</kbd> / <kbd>R</kbd>; <kbd>V</kbd> toggles the audio vario</td></tr>
    <tr><td>Menu / pause</td><td><kbd>Esc</kbd> (menu), <kbd>P</kbd> (pause)</td></tr></table>
    <h3>Phones and tablets</h3><p>Joystick on the left, throttle slider on the right, buttons for gear, flaps, spoilers, brake, view and menu; swipe to look around, pinch to zoom.</p>`;
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
