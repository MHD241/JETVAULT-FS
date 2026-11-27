// Main menu: Fly Now, World Map, Aircraft, Airports, Weather, Settings, Controls, About.
// Items that are not implemented yet are shown disabled and labelled as such.

import { airportVisible } from '../config';
import { SpawnKind } from '../sim/simulation';
import { WeatherSettings, CloudCover } from '../sim/weather';
import { InputSettings, saveInputSettings } from '../input/input';
import { airportCentre } from '../world/airport';
import { World } from '../world/world';
import { HomeGlobe } from './homeGlobe';
import { LocationMap } from './locationMap';
import { PRO } from '../config';
import { recommendPreset, currentMachine } from '../graphicsAuto';
import { stick, saveStickSens } from '../input/simpleControls';
import type { DirectorShot } from '../director';
import { SHOTS } from '../shotList';
import { aircraftAvailable, wallet } from '../economy';
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
  /** Shadows reach far: the shadow map widens with height (buildings in the city cast shadows on a final approach). Absent = on. */
  farShadows?: boolean;
  /** Post-processing budget (min: grading only, mid: + bloom, full: + ambient occlusion). Derived from the preset when absent. */
  fx?: 'min' | 'mid' | 'full';
}

export type GraphicsPreset = 'low' | 'high' | 'ultra';
/** Graphics presets. LOW favours frame rate (phones); HIGH is the default; ULTRA spends more GPU on shadows, terrain and draw distance. */
export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsSettings> = {
  low: { renderScale: 0.7, shadows: false, terrainDetail: 0.7, buildingDistanceKm: 6, clouds: true, shadowSize: 1024, softShadows: false, fx: 'min' },
  high: { renderScale: 1, shadows: true, terrainDetail: 1, buildingDistanceKm: 12, clouds: true, shadowSize: 2048, softShadows: true, fx: 'mid' },
  ultra: { renderScale: 1, shadows: true, terrainDetail: 1.5, buildingDistanceKm: 20, clouds: true, shadowSize: 4096, softShadows: true, fx: 'full' },
};

const GFX_STORE = 'jetvault.gfx.v1';
export function loadGraphics(): GraphicsSettings {
  let auto: 'low' | 'high' = 'high'; try { auto = recommendPreset(currentMachine()); } catch { /* ignore */ }
  const d: GraphicsSettings = { ...GRAPHICS_PRESETS[auto] };   // first launch: chosen from the screen and the machine (not saved until the player changes it)
  try { const s = localStorage.getItem(GFX_STORE); if (s) return { ...d, ...JSON.parse(s) }; } catch { /* ignore */ }
  return d;
}
export function saveGraphics(g: GraphicsSettings) { try { localStorage.setItem(GFX_STORE, JSON.stringify(g)); } catch { /* ignore */ } }

export type AirSpawn = { kind: 'air'; east: number; north: number; altFt: number; hdg: number };
export type AnySpawn = SpawnKind | AirSpawn;

export interface MenuHost {
  /** GeoFS-style forgiving handling (wings self-level). */
  assists: boolean;
  /** Passengers on board (airliners): their comfort is judged and pays JetCoins (see passengers.ts). */
  passengers: boolean;
  setPassengers(on: boolean): void;
  setAssists(on: boolean): void;
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
  directorStart(shot: DirectorShot, userOrbit?: boolean): Promise<void>;
  /** Multiplayer (net/multiplayer.ts): host or join a room, leave, chat. `mpState` is read by the page; the host calls `mpChanged` when it changes. */
  mpHost(name: string): Promise<string>;
  mpJoin(code: string, name: string): Promise<void>;
  mpLeave(): void;
  mpSay(text: string): void;
  mpState(): { code: string | null; host: boolean; roster: { id: string; name: string; me: boolean }[]; log: string[]; riding: string | null } | null;
  /** Ride along as a passenger in another player's aircraft (window seat), and stop. */
  mpRide(id: string): void;
  mpStopRide(): void;
  mpChanged: (() => void) | null;
  /** Opens the replay of the recorded flight (closes the menu). */
  replayOpen(): void;
}

type Tab = 'home' | 'credits' | 'fly' | 'map' | 'aircraft' | 'airports' | 'planner' | 'weather' | 'settings' | 'director' | 'multiplayer' | 'help' | 'market' | 'privacy' | 'controls' | 'training' | 'about';


export class Menu {
  readonly el: HTMLDivElement;
  private section: HTMLElement;
  private footer!: HTMLElement;
  private globe = new HomeGlobe();
  private globeWrap!: HTMLElement;
  private homeEl!: HTMLElement;
  home = true;
  private step = 1;
  private tab: Tab = 'fly';
  private spawn: AnySpawn = { kind: 'stand', index: 0, coldAndDark: false };
  open = true;
  private mapCanvas: HTMLCanvasElement | null = null;
  private hillshade: ImageData | null = null;

  constructor(private host: MenuHost) {
    this.el = document.createElement('div');
    this.el.className = 'jv-menu home';
    const nav = document.createElement('nav');
    nav.innerHTML = `<button class="jv-back" aria-label="Back to the home screen">\u2039</button><div class="jv-ptitle"></div><div class="jv-pill coins" data-c="coins"></div><div class="jv-brand"><span class="jv-logo"></span><span>JETVAULT<small>FLIGHT SIMULATOR</small></span></div><div class="jv-tabs"></div>`;
    (nav.querySelector('.jv-back') as HTMLElement).onclick = () => this.goBack();
    const tabs = nav.querySelector('.jv-tabs') as HTMLElement;
    const items: [Tab, string, boolean, string?][] = [
      ['home', 'Home', true], ['fly', 'Fly Now', true], ['map', 'World Map', true], ['aircraft', 'Aircraft Selection', true],
      ['airports', 'Airport Selection', true], ['planner', 'Flight Planner', false, 'Not yet available'],
      ['weather', 'Weather', true], ['settings', 'Settings', true], ['multiplayer', 'Multiplayer', true], ...(PRO ? [['director', 'Director (film mode)', true] as [Tab, string, boolean]] : []), ['controls', 'Controls', true],
      ['training', 'Training', false, 'Not yet available'], ['about', 'About JetVault', true],
    ];
    for (const [t, name, enabled, note] of items) {
      const b = document.createElement('button');
      b.innerHTML = `${name}${note ? `<small>${note}</small>` : ''}`;
      b.disabled = !enabled;
      b.dataset.tab = t;
      b.onclick = () => { if (t === 'home') { this.setHome(true); return; } this.tab = t; this.render(); };
      tabs.appendChild(b);
    }
    this.section = document.createElement('section');
    const footer = document.createElement('footer');
    footer.innerHTML = `<button class="jv-btn ghost" data-f="back">\u2039 BACK</button><div class="hint"><kbd>ESC</kbd> Close the menu</div><div class="grow"></div><button class="jv-btn ghost" data-f="resume">RESUME FLIGHT</button><button class="jv-btn" data-f="fly">FLY</button>`;
    (footer.querySelector('[data-f=back]') as HTMLElement).onclick = () => this.goBack();
    (footer.querySelector('[data-f=fly]') as HTMLElement).onclick = () => this.primary();
    (footer.querySelector('[data-f=resume]') as HTMLElement).onclick = () => this.host.resume();
    this.footer = footer;
    const page = document.createElement('div'); page.className = 'jv-page'; page.append(nav, this.section, footer);
    (nav.querySelector('.jv-brand') as HTMLElement).onclick = () => this.setHome(true);
    this.homeEl = this.buildHome();
    host.mpChanged = () => this.updateMp();
    this.el.append(this.homeEl, page);
    document.body.appendChild(this.el);
    this.render();
    this.setHome(true);
    this.updateCoins(); wallet.onChange(() => this.updateCoins());
  }

  show() { this.open = true; this.el.style.display = ''; this.setHome(true); }
  hide() { this.open = false; this.el.style.display = 'none'; this.globe.stop(); }

  /** Home screen (picture tiles + globe) or one of the pages. */
  setHome(on: boolean) {
    this.home = on;
    this.el.classList.toggle('home', on);
    if (on) { this.refreshHome(); this.globeWrap.appendChild(this.globe.canvas); this.globe.reset(); this.globe.onClick = () => this.go('fly'); this.globe.start(); } else { this.globe.stop(); this.render(); }
  }
  private updateCoins() { this.el.querySelectorAll('[data-c=coins]').forEach((e) => { e.innerHTML = `<span class="jc">\u25c8</span> ${wallet.coins.toLocaleString()} JetCoins`; }); }
  /** A short message at the top of the menu. */
  private notice(text: string) {
    this.el.querySelector('.jv-notice')?.remove();
    const n = document.createElement('div'); n.className = 'jv-notice'; n.textContent = text; this.el.appendChild(n);
    setTimeout(() => n.remove(), 4500);
  }
  go(tab: Tab) { this.tab = tab; if (tab === 'fly') this.step = 1; this.setHome(false); }
  /** Back: one step back inside Fly Now, otherwise to the home screen. */
  private goBack() { if (!this.home && this.tab === 'fly' && this.step > 1) { this.step--; this.render(); } else this.setHome(true); }
  /** The big button on the right: NEXT through the Fly Now steps, then FLY. */
  private primary() { if (this.tab === 'fly' && this.step < 4) { this.step++; this.render(); } else this.host.fly(this.spawn); }
  private refreshHome() {
    const r = this.homeEl.querySelector('[data-h=resume]') as HTMLElement | null; if (r) r.style.display = this.host.canResume() ? '' : 'none';
    const a = this.homeEl.querySelector('[data-h=airport]'); if (a) a.textContent = `${this.host.world.airport.icao} \u00b7 ${this.host.world.airport.name}`;
  }
  private buildHome(): HTMLElement {
    const h = document.createElement('div'); h.className = 'jv-home';
    // stars
    const stars = document.createElement('div'); stars.className = 'jv-stars';
    let sd = 99; const rnd = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
    stars.style.boxShadow = Array.from({ length: 140 }, () => `${Math.round(rnd() * 1900)}px ${Math.round(rnd() * 1100)}px 0 ${rnd() < 0.2 ? 1 : 0}px rgba(255,255,255,${(0.25 + rnd() * 0.6).toFixed(2)})`).join(',');
    const wrap = document.createElement('div'); wrap.className = 'jv-globe-wrap'; wrap.appendChild(this.globe.canvas); this.globeWrap = wrap;
    // area, title, picture, page, available (a greyed tile is not built yet)
    const tiles: [string, string, string, Tab, boolean][] = [
      ['f', 'Free Flight', 'free', 'fly', true], ['k', 'Career', 'airports', 'fly', false], ['l', 'Challenges', 'map', 'fly', false],
      ['m', 'Marketplace', 'aircraft', 'market', true], ['h', 'Help', 'settings', 'help', true],
    ];
    const mosaic = document.createElement('div'); mosaic.className = 'jv-mosaic';
    for (const [area, title, img, tab, on] of tiles) {
      const t = document.createElement('button'); t.className = `jv-tile t-${area}${on ? '' : ' off'}`; t.style.backgroundImage = `url(./menu/${img}.jpg)`;
      t.innerHTML = `<span>${title}</span>${on ? '' : '<em>COMING SOON</em>'}`;
      if (on) t.onclick = () => this.go(tab); else t.setAttribute('aria-disabled', 'true');
      mosaic.appendChild(t);
    }
    const hints = document.createElement('div'); hints.className = 'jv-hints';
    hints.innerHTML = `<button data-h="resume"><kbd>Esc</kbd> Resume flight</button><button data-h="controls"><kbd>?</kbd> Controls</button><button data-h="about"><kbd>i</kbd> About JetVault</button><button data-h="credits"><kbd>\u2605</kbd> Acknowledgements</button>`;
    if (PRO) { const d = document.createElement('button'); d.innerHTML = '<kbd>\u25b6</kbd> Director'; d.onclick = () => this.go('director'); hints.appendChild(d); }
    { const r = document.createElement('button'); r.innerHTML = '<kbd>V</kbd> Replay'; r.onclick = () => this.host.replayOpen(); hints.appendChild(r); }
    { const m = document.createElement('button'); m.innerHTML = '<kbd>\u2708</kbd> Multiplayer'; m.onclick = () => this.go('multiplayer'); hints.appendChild(m); }
    (hints.querySelector('[data-h=credits]') as HTMLElement).onclick = () => this.go('credits');
    (hints.querySelector('[data-h=resume]') as HTMLElement).onclick = () => this.host.resume();
    (hints.querySelector('[data-h=controls]') as HTMLElement).onclick = () => this.go('controls');
    (hints.querySelector('[data-h=about]') as HTMLElement).onclick = () => this.go('about');
    const top = document.createElement('div'); top.className = 'jv-hometop';
    top.innerHTML = `<div class="jv-pill"><span class="jv-logo"></span><b>JETVAULT</b></div><div class="jv-pill ap" data-h="airport"></div><div class="jv-pill ed">${PRO ? 'PRO' : 'FREE'}</div><div class="jv-pill coins" data-c="coins"></div><button class="jv-pill gear" title="Settings" aria-label="Settings">\u2699</button>`;
    (top.querySelector('.gear') as HTMLElement).onclick = () => this.go('settings');
    h.append(stars, wrap, mosaic, hints, top);
    return h;
  }

  private render() {
    this.el.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === this.tab));
    const s = this.section;
    const h = this.host;
    s.innerHTML = '';
    if (!this.home && !(this.tab === 'fly' && this.step === 2)) this.globe.stop();   // the globe is only drawn on the Home screen and in the location step
    (this.footer.querySelector('[data-f=resume]') as HTMLElement).style.display = this.host.canResume() ? '' : 'none';
    const titles: Record<Tab, string> = { home: 'Home', credits: 'Acknowledgements', fly: 'Fly Now', map: 'World Map', aircraft: 'Aircraft Selection', airports: 'Airport Selection', planner: 'Flight Planner', weather: 'Weather', settings: 'Settings', director: 'Director', multiplayer: 'Multiplayer', help: 'Help', market: 'Marketplace', privacy: 'Privacy', controls: 'Controls', training: 'Training', about: 'About JetVault' };
    const pt = this.el.querySelector('.jv-ptitle'); if (pt) pt.textContent = titles[this.tab];
    const fb = this.footer.querySelector('[data-f=fly]') as HTMLElement;
    fb.style.display = ['fly', 'aircraft', 'airports', 'map'].includes(this.tab) ? '' : 'none';
    fb.textContent = this.tab === 'fly' && this.step < 4 ? 'NEXT \u203a' : 'FLY';
    if (this.tab === 'fly') this.renderFly(s);
    else if (this.tab === 'map') this.renderMap(s);
    else if (this.tab === 'aircraft' || this.tab === 'market') this.renderAircraft(s);
    else if (this.tab === 'help') this.renderHelp(s);
    else if (this.tab === 'privacy') this.renderPrivacy(s);
    else if (this.tab === 'airports') {
      s.innerHTML = `<h2>Airport Selection</h2><p>Scotland is one continuous map: Copernicus terrain and land cover everywhere, with full detail (satellite imagery, roads, buildings, airfield) around Edinburgh Airport (the only airport enabled for now).</p>`;
      const grid = document.createElement('div'); grid.className = 'jv-grid';
      for (const a of h.world.airports.filter((x) => airportVisible(x.icao))) {
        const c = document.createElement('div');
        c.className = 'jv-card' + (a.icao === h.world.airport.icao ? ' sel' : '');
        c.innerHTML = `<b>${a.icao} ${a.name}</b><span>${a.runways.map((r) => `Runway ${r.id} · ${Math.round(r.length)} m · ${r.surface}`).join('<br>')}<br>Elevation ${(a.arp.elev / 0.3048).toFixed(0)} ft</span>`;
        c.onclick = () => { h.world.setAirport(a.icao); this.spawn = { kind: 'stand', index: 0, coldAndDark: false }; c.style.opacity = '0.6'; void this.host.airportChanged().then(() => this.render()); };
        grid.appendChild(c);
      }
      s.appendChild(grid);
    } else if (this.tab === 'weather') this.renderWeather(s);
    else if (this.tab === 'credits') this.renderCredits(s);
    else if (this.tab === 'settings') this.renderSettings(s);
    else if (this.tab === 'director') this.renderDirector(s);
    else if (this.tab === 'multiplayer') this.renderMultiplayer(s);
    else if (this.tab === 'controls') this.renderControls(s);
    else if (this.tab === 'about') {
      s.innerHTML = `<h2>About JetVault Flight Simulator</h2>
      <p>Version 0.1 development build. A browser-based flight simulator with a six-degree-of-freedom flight model built from
      lifting-surface aerodynamics, a piston engine and propeller model, and spring-damper landing gear on real terrain.
      The Cessna 172S model is validated against its Pilot's Operating Handbook in an automated test suite.</p>
      <h3>Data and licences</h3><p>${h.attribution.map((a) => `${a}`).join('<br>')}</p>
      <p>"A350 V5" by <a href="https://skfb.ly/pINtM" target="_blank" rel="noopener" style="color:#8ab4ff">Newbie99999993</a>, "Lufthansa Airbus A340-600" by <a href="https://skfb.ly/pGwVB" target="_blank" rel="noopener" style="color:#8ab4ff">Dave Love SketchFab</a> and "Airbus A320-200" by <a href="https://sketchfab.com/3d-models/airbus-a320-200-02470bf974e645f78f5d9385a333e9e0" target="_blank" rel="noopener" style="color:#8ab4ff">Dlourine</a> (Sketchfab), all licensed <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">CC BY 4.0</a>; converted and reduced for the game.</p>
      <p>"C-17A Globemaster III" 3D model by <a href="https://sketchfab.com/VTX_car" target="_blank" rel="noopener" style="color:#8ab4ff">VTX</a> on Sketchfab, licensed <a href="http://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">CC BY-NC-SA 4.0</a> (non-commercial; shared under the same licence).</p>
      <p>"Jetway" 3D model by <a href="https://skfb.ly/oUZou" target="_blank" rel="noopener" style="color:#8ab4ff">vishnevsky.yaroslav</a> on Sketchfab, licensed <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">CC BY 4.0</a>.</p>
      <p>"Moon" 3D model by <a href="https://skfb.ly/6TwGU" target="_blank" rel="noopener" style="color:#8ab4ff">Akshat</a> on Sketchfab, licensed <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">CC BY 4.0</a>.</p>
      <p>"The Sun" 3D model by <a href="https://skfb.ly/oy8RZ" target="_blank" rel="noopener" style="color:#8ab4ff">tamminen</a> on Sketchfab, licensed <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">CC BY 4.0</a>.</p>
      <p>"Tree low poly lowpoly" 3D model by <a href="https://skfb.ly/pO6MX" target="_blank" rel="noopener" style="color:#8ab4ff">00amza</a> on Sketchfab, licensed <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">CC BY 4.0</a>.</p>
      <p>Boeing 737-800 (American Airlines) 3D model by <a href="https://www.cgtrader.com/designers/boy737?utm_source=credit&amp;utm_source=credit_item_page" target="_blank" rel="noopener" style="color:#8ab4ff">boy737</a> on CGTrader. Scaled, repositioned and converted to glTF.</p>
      <p>"UNDERPOLY: Free Sailplane Glider" (<a href="https://skfb.ly/oMDMu" target="_blank" rel="noopener" style="color:#8ab4ff">https://skfb.ly/oMDMu</a>) by UNDERPOLY Project is licensed under Creative Commons Attribution (<a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">http://creativecommons.org/licenses/by/4.0/</a>).</p>
      <p>"Boeing 737-800 Cockpit" (<a href="https://skfb.ly/oSGxK" target="_blank" rel="noopener" style="color:#8ab4ff">https://skfb.ly/oSGxK</a>) by hakai315 is licensed under Creative Commons Attribution (<a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#8ab4ff">http://creativecommons.org/licenses/by/4.0/</a>).</p>
      <p>The 737-800 exterior mesh is used under rights held by the project owner; its original airline livery has been recoloured to a neutral scheme. The original third-party cockpit model (credited above) is available with ?oldcockpit; the default flight deck, the studio and all other textures and instrument artwork are original assets created for JetVault.
      JetVault is not affiliated with Microsoft, Asobo, Textron Aviation or any airport operator.</p>`;
    }
  }

  /** Fly Now as four steps: 1 aircraft, 2 location, 3 weather, 4 ready (summary, then the FLY button loads the game). */
  private renderFly(s: HTMLElement) {
    s.innerHTML = '';
    const names = ['Aircraft', 'Location', 'Weather', 'Ready'];
    const bar = document.createElement('div'); bar.className = 'jv-steps';
    names.forEach((n, i) => {
      const st = document.createElement('button'); st.className = 'st' + (i + 1 === this.step ? ' on' : '') + (i + 1 < this.step ? ' done' : '');
      st.innerHTML = `<b>${i + 1 < this.step ? '\u2713' : i + 1}</b><span>${n}</span>`;
      st.onclick = () => { if (i + 1 <= this.step) { this.step = i + 1; this.render(); } };
      bar.appendChild(st);
    });
    const body = document.createElement('div'); body.className = 'jv-stepbody';
    s.append(bar, body);
    if (this.step === 1) { body.insertAdjacentHTML('beforeend', '<h3>Choose your aircraft</h3>'); this.aircraftPicker(body); }
    else if (this.step === 2) this.renderLocation(body);
    else if (this.step === 3) this.renderWeather(body);
    else this.renderReady(body);
  }

  /** What was picked on the map: a gate (by position, so the right stand is found for whichever aircraft is chosen) or a runway's final approach. */
  private pick: { gate?: { x: number; y: number }; final?: string } = {};
  /** Gate starts: ready to fly (the default here; MSFS starts parked aircraft cold and dark) or cold and dark. */
  private coldDark = false;
  private standsOf(): [number, number, number][] { const ap = this.host.world.airport; return (this.host.aircraft.def.profile.standClearance > 12 && ap.standsJet?.length ? ap.standsJet : ap.stands) as [number, number, number][]; }
  private nearestStand(g: { x: number; y: number }): number {
    let best = 0, d = Infinity; this.standsOf().forEach((s, i) => { const dd = Math.hypot(s[0] - g.x, s[1] - g.y); if (dd < d) { d = dd; best = i; } }); return best;
  }
  /** The spawn to fly: a picked gate or final approach is resolved against the aircraft that is selected now. */
  private resolvedSpawn(): AnySpawn {
    const def = this.host.aircraft.def;
    if (this.pick.final) return { kind: 'approach', ident: this.pick.final, distanceNm: def.profile.standClearance > 12 ? 6 : 3 };
    if (this.pick.gate && this.standsOf().length) return { kind: 'stand', index: this.nearestStand(this.pick.gate), coldAndDark: this.coldDark };
    if (this.spawn.kind === 'stand') return { ...this.spawn, coldAndDark: this.coldDark };
    return this.spawn;
  }
  private makeMap(cv: HTMLCanvasElement, cb: { loaded: () => void; picked: () => void }): LocationMap {
    const h = this.host;
    return new LocationMap(cv, {
      world: h.world, hillshade: () => this.hillshadeCanvas(), stands: () => this.standsOf(), visible: (i) => airportVisible(i),
      select: async (icao) => { h.world.setAirport(icao); this.pick = {}; this.spawn = { kind: 'stand', index: 0, coldAndDark: false }; await h.airportChanged(); cb.loaded(); },
      pickedStand: () => (this.pick.gate ? this.nearestStand(this.pick.gate) : null),
      onPick: (i) => { const s = this.standsOf()[i]; this.pick = { gate: { x: s[0], y: s[1] } }; cb.picked(); },
      onPickFinal: (id) => { this.pick = { final: id }; cb.picked(); },
      pickedFinal: () => this.pick.final ?? null,
    });
  }

  private locMap: LocationMap | null = null;
  /**
   * Free Flight, step 2 (as in MSFS: after the aircraft): the globe. Click it (or search an ICAO code) and it zooms into the UK, where the flat map takes over
   * with a star and code at every airport; click one for a bird's-eye view with a star at every gate and an orange FINAL star at every runway end.
   */
  private renderLocation(body: HTMLElement) {
    this.locMap?.destroy(); this.locMap = null;
    const h = this.host, def = h.aircraft.def;
    if (def.glider) { this.renderLocationList(body); return; }
    body.insertAdjacentHTML('beforeend', '<h3>Where do you want to start?</h3>');
    // search by ICAO code
    const sr = document.createElement('div'); sr.className = 'jv-row';
    sr.innerHTML = '<label>Search</label><input type="text" maxlength="4" placeholder="ICAO code, e.g. EGLL" style="width:190px;text-transform:uppercase"><button class="jv-btn">GO</button><span class="msg" style="margin-left:12px"></span>';
    const sin = sr.querySelector('input') as HTMLInputElement, sgo = sr.querySelector('button') as HTMLButtonElement, smsg = sr.querySelector('.msg') as HTMLElement;
    sin.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') sgo.click(); };
    // the globe and, over it, the flat map
    const wrap = document.createElement('div'); wrap.className = 'jv-locmap';
    wrap.appendChild(this.globe.canvas); this.globe.reset(); this.globe.start();
    const cv = document.createElement('canvas'); cv.width = cv.height = 900; cv.className = 'jv-map'; cv.style.touchAction = 'none';
    const cta = document.createElement('div'); cta.className = 'cta'; cta.innerHTML = '<span>\u2605</span> Click the globe to choose where to fly';
    const back = document.createElement('button'); back.className = 'jv-btn ghost'; back.textContent = '\u2039 BACK'; back.style.display = 'none'; back.style.margin = '8px 8px 0 0';
    wrap.append(cv, cta);
    const info = document.createElement('div'); info.className = 'jv-sum'; info.style.marginTop = '8px';
    const opts = document.createElement('div'); opts.className = 'jv-row'; opts.style.marginTop = '8px';
    const cards = document.createElement('div');
    const refresh = () => {
      const gate = this.resolvedSpawn().kind === 'stand';
      info.innerHTML = `<div><span>Start</span><b>${h.world.airport.icao} ${h.world.airport.name}</b><i>${this.spawnLabel()}</i></div>`;
      opts.style.display = gate ? '' : 'none';
      opts.innerHTML = gate ? `<label>Aircraft state</label><select><option value="0" ${this.coldDark ? '' : 'selected'}>Ready to fly (engines running)</option><option value="1" ${this.coldDark ? 'selected' : ''}>Cold and dark</option></select>` : '';
      (opts.querySelector('select') as HTMLSelectElement | null)?.addEventListener('change', (e) => { this.coldDark = (e.target as HTMLSelectElement).value === '1'; refresh(); });
      this.startCards(cards, refresh); this.locMap?.draw();
    };
    let flat = false;
    const showFlat = async () => {
      if (flat) return; flat = true;
      cta.style.display = 'none';
      await this.globe.zoomTo(54.3, -3.2, 1500);
      wrap.classList.add('flat'); this.globe.stop();   // the flat map covers the globe: stop drawing it
      const map = this.makeMap(cv, { loaded: refresh, picked: refresh }); this.locMap = map;
      map.onMode = (m) => { back.style.display = m === 'uk' ? 'none' : ''; };
      back.onclick = () => map.showUK();
    };
    this.globe.onClick = () => void showFlat();
    sgo.onclick = async () => {
      const code = sin.value.trim().toUpperCase(), a = h.world.airports.find((x) => x.icao === code && airportVisible(x.icao));
      if (!a) { smsg.textContent = `No airport with the code "${code}". Available: ${h.world.airports.filter((x) => airportVisible(x.icao)).map((x) => x.icao).join(', ')}`; return; }
      smsg.textContent = ''; await showFlat(); void this.locMap?.open(code);
    };
    body.append(sr, wrap, back, info, opts, cards);
    refresh();
  }
  /** The start-type cards (runway, final approach) of the current airport; `after` runs when one is chosen. */
  private startCards(body: HTMLElement, after: () => void) {
    body.innerHTML = '<h3>Or start on a runway or on final</h3>';
    const ap = this.host.world.airport, def = this.host.aircraft.def, jet = def.profile.standClearance > 12;
    const idents = ap.runways.flatMap((r) => r.ends.map((e) => e.ident));
    const grid = document.createElement('div'); grid.className = 'jv-grid';
    const opts: [AnySpawn, string, string][] = [
      ...idents.map((id): [AnySpawn, string, string] => [{ kind: 'runway', ident: id }, `Runway ${id}`, jet ? 'Lined up, engines running, flaps 5' : 'Lined up, engine running']),
      ...idents.slice(0, 2).map((id): [AnySpawn, string, string] => [{ kind: 'approach', ident: id, distanceNm: jet ? 6 : 3 }, `Final approach ${id}`, jet ? '6 nm, 3\u00b0 glidepath, flaps 30, gear down' : '3 nm, 3\u00b0 glidepath, flaps 10']),
    ];
    const key = (k: AnySpawn) => JSON.stringify({ ...k, coldAndDark: undefined });
    for (const [k, t, d] of opts) {
      const c = document.createElement('div');
      c.className = 'jv-card' + (key(k) === key(this.spawn) ? ' sel' : '');
      c.innerHTML = `<b>${t}</b><span>${d}</span>`;
      c.onclick = () => { this.spawn = k; after(); };
      grid.appendChild(c);
    }
    body.appendChild(grid);
  }

  private renderLocationList(body: HTMLElement) {
    const ap = this.host.world.airport;
    const def = this.host.aircraft.def;
    const jet = def.profile.standClearance > 12;
    const glider = !!def.glider;
    body.insertAdjacentHTML('beforeend', `<h3>Airport</h3><div class="jv-grid"><div class="jv-card sel"><b>${ap.icao} ${ap.name}</b><span>${ap.runways.map((r) => `Runway ${r.id}`).join(', ')}<br>Change it under Airport Selection (the Home screen).</span></div></div><h3>Where do you start?</h3>`);
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
    body.appendChild(grid);
  }

  private spawnLabel(): string {
    const k = this.spawn;
    return k.kind === 'stand' ? `Stand ${k.index + 1} (parked)` : k.kind === 'runway' ? `Runway ${k.ident}, lined up` : k.kind === 'approach' ? `Final approach to runway ${k.ident}, ${k.distanceNm} nm` : `Airborne at ${Math.round(k.altFt)} ft`;
  }

  private renderReady(body: HTMLElement) {
    const h = this.host, w = h.weather, ap = h.world.airport;
    const time = w.realTime ? 'real time' : `${String(Math.floor(w.timeOfDay)).padStart(2, '0')}:${String(Math.round((w.timeOfDay % 1) * 60)).padStart(2, '0')} UTC`;
    body.insertAdjacentHTML('beforeend', `<h3>Ready to fly</h3><div class="jv-sum">
      <div><span>Aircraft</span><b>${h.aircraft.def.name}</b></div>
      <div><span>Location</span><b>${ap.icao} ${ap.name}</b><i>${this.spawnLabel()}</i></div>
      <div><span>Weather</span><b>Wind ${Math.round(w.windDirection)}\u00b0 / ${Math.round(w.windSpeed)} kt</b><i>${w.cloudCover} \u00b7 visibility ${(w.visibility / 1000).toFixed(w.visibility < 10000 ? 1 : 0)} km \u00b7 ${time}</i></div></div>`);
    const form = document.createElement('div'); form.className = 'jv-form'; form.style.marginTop = '20px';
    form.innerHTML = `<label>Start view</label><select id="sv"><option value="cockpit" ${h.startView === 'cockpit' ? 'selected' : ''}>Cockpit</option><option value="chase" ${h.startView === 'chase' ? 'selected' : ''}>External (chase)</option></select><span></span>`;
    form.querySelector('#sv')!.addEventListener('change', (e) => { h.startView = (e.target as HTMLSelectElement).value as 'cockpit' | 'chase'; });
    const big = h.aircraft.def.profile.standClearance > 12;
    const pax = document.createElement('div'); pax.className = 'jv-form'; pax.style.marginTop = '12px';
    pax.innerHTML = `<label>Passengers</label><select id="px" ${big ? '' : 'disabled'}><option value="0" ${h.passengers && big ? '' : 'selected'}>None</option><option value="1" ${h.passengers && big ? 'selected' : ''}>Carry passengers: smooth flying earns more JetCoins</option></select><span>${big ? '' : 'Airliners only'}</span>`;
    pax.querySelector('#px')!.addEventListener('change', (e) => h.setPassengers((e.target as HTMLSelectElement).value === '1'));
    body.append(form, pax);
    const help = document.createElement('p');
    help.innerHTML = 'Controls: mouse = fly, inverted (move from the centre of the screen; mouse up = nose down) · 1-9 = throttle (1 idle, 9 full) · Left/Right arrows = rudder · Space = brakes · F = flaps (cycles) · G = gear · B = spoilers · J = jet bridge (when parked at a gate) · K = parking brake · U = pushback · gliders: L/R = winch launch / release cable, N = BUNGEE launch (Mach 1), V = vario sound · C = cockpit/outside view · mouse wheel / pinch = zoom · right-drag or two-finger scroll = look · Esc = menu. On phones and tablets: joystick on the left, throttle slider on the right, buttons for the rest.';
    body.appendChild(help);
  }

  /** Everyone whose work is in the game. */
  private renderCredits(s: HTMLElement) {
    const L = (t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
    const BY = L('CC BY 4.0', 'http://creativecommons.org/licenses/by/4.0/');
    const groups: [string, [string, string, string, string][]][] = [
      ['Aircraft', [
        ['Boeing 737-800 (exterior)', L('boy737', 'https://www.cgtrader.com/designers/boy737'), 'CGTrader; used under rights held by the project owner. Recoloured to a neutral scheme.', 'The 737-800'],
        ['Boeing 737-800 Cockpit', L('hakai315', 'https://skfb.ly/oSGxK'), BY, 'Optional old flight deck (?oldcockpit)'],
        ['Airbus A320-200', L('Dlourine', 'https://sketchfab.com/3d-models/airbus-a320-200-02470bf974e645f78f5d9385a333e9e0'), BY, 'The A320'],
        ['A320 Cockpit 2', L('davidmarton1987', 'https://sketchfab.com/3d-models/a320-cockpit-2-5fb0c671a91042c1a9d8f2cf3e2df021'), BY, 'The flight deck of the A320, A340 and A350'],
        ['Lufthansa Airbus A340-600', L('Dave Love SketchFab', 'https://skfb.ly/pGwVB'), BY, 'The A340-600'],
        ['A350 V5', L('Newbie99999993', 'https://skfb.ly/pINtM'), BY, 'The A350-1000'],
        ['C-17A Globemaster III', L('VTX', 'https://sketchfab.com/VTX_car'), L('CC BY-NC-SA 4.0', 'http://creativecommons.org/licenses/by-nc-sa/4.0/') + ' (non-commercial, share-alike)', 'The C-17A'],
        ['UNDERPOLY: Free Sailplane Glider', L('UNDERPOLY Project', 'https://skfb.ly/oMDMu'), BY, 'The glider'],
      ]],
      ['World', [
        ['Jetway', L('vishnevsky.yaroslav', 'https://skfb.ly/oUZou'), BY, 'Boarding bridges'],
        ['The Sun', L('tamminen', 'https://skfb.ly/oy8RZ'), BY, 'The sun'],
        ['Moon', L('Akshat', 'https://skfb.ly/6TwGU'), BY, 'The moon'],
        ['City Buildings pack', '3DTGRL', 'CGTrader; used under rights held by the project owner', 'Landmark towers (Pro)'],
      ]],
    ];
    let html = '<p>JetVault is built on the work of many people. Thank you to everyone below.</p>';
    for (const [name, rows] of groups) {
      html += `<h3>${name}</h3><div class="jv-credits">`;
      for (const [title, by, lic, use] of rows) html += `<div><b>${title}</b><span>by ${by}</span><span class="lic">${lic}</span><i>${use}</i></div>`;
      html += '</div>';
    }
    html += `<h3>Data</h3><p>${this.host.attribution.join('<br>')}</p><p>JetVault is not affiliated with Microsoft, Asobo, Boeing, Airbus, Lockheed Martin or any airport operator. Aircraft names are used to identify the real aircraft the models depict.</p>`;
    s.innerHTML = html;
  }

  private renderMap(s: HTMLElement) {
    const lo = this.host.world.terrain.lo!;
    s.innerHTML = `<h2>World Map</h2><p>Scotland, ${lo.half * 2 / 1000} x ${lo.half * 2 / 1000} km (terrain at ${lo.step} m, the ground gets coarser the higher you fly). Click the map to start airborne at that position. Airports with full detail: ${this.host.world.airports.filter((a) => airportVisible(a.icao)).map((a) => a.icao).join(', ')}.</p>`;
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

  /** The regional hillshade (terrain shading, land cover colours) as image data, `W` pixels square over the whole lo-resolution grid. */
  private buildHillshade(W: number): ImageData {
    const grid = this.host.world.terrain.lo!;
    const g = document.createElement('canvas').getContext('2d')!;
    {
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
      return img;
    }
  }
  private hsCanvas: HTMLCanvasElement | null = null;
  hillshadeCanvas(): HTMLCanvasElement {
    if (!this.hsCanvas) { const c = document.createElement('canvas'); c.width = c.height = 900; c.getContext('2d')!.putImageData(this.hillshade && this.hillshade.width === 900 ? this.hillshade : this.buildHillshade(900), 0, 0); this.hsCanvas = c; }
    return this.hsCanvas;
  }

  drawMap() {
    const cv = this.mapCanvas;
    if (!cv || !cv.isConnected) return;
    const g = cv.getContext('2d')!;
    const grid = this.host.world.terrain.lo!;
    const W = cv.width;
    if (!this.hillshade) this.hillshade = this.buildHillshade(W);
    g.putImageData(this.hillshade, 0, 0);
    const P = (e: number, n: number): [number, number] => [((e + grid.half) / (2 * grid.half)) * W, ((grid.half - n) / (2 * grid.half)) * W];
    g.font = '12px sans-serif';
    for (const a of this.host.world.airports.filter((x) => airportVisible(x.icao))) {
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
      darter: 'FICTIONAL 6 m rocket glider built for the bungee launch (N at a launch point): Mach 1 in seconds, then a fast glide · wave drag above Mach 0.9',
      b738: '2 x CFM56-7B26 (117 kN) · glass PFD/ND · flaps, slats, spoilers, reversers, retractable gear',
      a320: '2 x CFM56-5B4 · the A320-200 (model by Dlourine) · detailed flight deck (static screens)',
      a340: '4 x Trent 556 · the Lufthansa A340-600 (model by Dave Love SketchFab) · uses the A320 flight deck',
      a350: '2 x Trent XWB · the A350-1000 (model by Newbie99999993) · uses the A320 flight deck',
      c17: '4 x F117 (about 180 kN) · the C-17A Globemaster III (model by VTX) · flight deck and cargo hold · ESTIMATED handling, scaled from the 737',
    };
    for (const d of this.host.aircraftDefs) {
      const c = document.createElement('div');
      const locked = !aircraftAvailable(d.id);
      c.className = 'jv-card' + (d.id === this.host.aircraft.def.id ? ' sel' : '') + (locked ? ' locked' : '');
      const cv = document.createElement('canvas'); cv.width = 260; cv.height = 150; cv.style.width = '100%';
      drawPlanform(cv, d);
      c.appendChild(cv);
      c.insertAdjacentHTML('beforeend', `<b>${d.name}</b><span>${blurb[d.id] ?? ''}<br>MTOW ${d.maxTakeoffMass.toLocaleString()} kg · span ${d.wingSpan.toFixed(1)} m</span>`);
      const price = wallet.price(d.id);
      if (locked) c.insertAdjacentHTML('afterbegin', `<em class="jv-lock">${price ? `\ud83d\udd12 \u25c8 ${price.toLocaleString()}` : '\ud83d\udd12 PRO'}</em>`);
      c.onclick = () => {
        if (locked) {
          if (price && wallet.canBuy(d.id)) {
            if (confirm(`Unlock the ${d.name} for ${price.toLocaleString()} JetCoins?`)) { wallet.buy(d.id); this.notice(`${d.name} unlocked. Enjoy the flight!`); this.host.selectAircraft(d.id); this.spawn = { kind: 'stand', index: 0, coldAndDark: false }; this.render(); }
            return;
          }
          c.classList.add('shake'); setTimeout(() => c.classList.remove('shake'), 400);
          this.notice(price ? `You need ${(price - wallet.coins).toLocaleString()} more JetCoins (you have ${wallet.coins.toLocaleString()}). Earn them by flying and landing.` : 'This aircraft is part of the Pro edition.');
          return;
        }
        this.host.selectAircraft(d.id); this.spawn = { kind: 'stand', index: 0, coldAndDark: false }; this.render(); };
      grid.appendChild(c);
    }
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
      form.insertAdjacentHTML('beforeend', `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${w[k] ?? (k === 'timeRate' ? 1 : '')}" data-k="${k}"><span class="val">${w[k] ?? (k === 'timeRate' ? 1 : '')} ${unit}</span>`);
    };
    range('windDirection', 'Wind direction (from, true)', 0, 359, 1, '°');
    range('windSpeed', 'Wind speed', 0, 40, 1, 'kt');
    range('gustSpeed', 'Gusts to', 0, 50, 1, 'kt');
    range('turbulence', 'Turbulence', 0, 1, 0.05, '');
    range('visibility', 'Visibility (fog distance)', 200, 120000, 100, 'm');
    form.insertAdjacentHTML('beforeend', `<label>Cloud cover</label><select data-k="cloudCover">${(['SKC', 'FEW', 'SCT', 'BKN', 'OVC'] as CloudCover[]).map((c) => `<option ${c === w.cloudCover ? 'selected' : ''}>${c}</option>`).join('')}</select><span></span>`);
    range('cloudBaseFt', 'Cloud base', 500, 10000, 100, 'ft');
    range('temperatureC', 'Temperature (field)', -20, 35, 1, '°C');
    range('qnh', 'QNH', 960, 1050, 1, 'hPa');
    range('rain', 'Rain', 0, 1, 0.05, '');
    form.insertAdjacentHTML('beforeend', `<label>Real time (sun and moon match where you fly)</label><input type="checkbox" data-k="realTime" ${w.realTime ? 'checked' : ''}><span></span>`);
    range('timeRate', 'Clock speed (1 = real time; try 300 to watch a sunrise)', 1, 3600, 1, 'x');
    range('timeOfDay', 'Time (UTC) - used when real time is off', 0, 23.75, 0.25, 'h');
    range('dayOfYear', 'Day of year - used when real time is off', 1, 365, 1, '');
    form.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.dataset.k as keyof WeatherSettings;
      if (t.type === 'checkbox') { (w as any)[k] = t.checked; return; }
      (w as any)[k] = t.tagName === 'SELECT' ? t.value : parseFloat(t.value);
      if (k === 'timeOfDay' || k === 'dayOfYear') { w.realTime = false; const cb = form.querySelector('input[data-k="realTime"]') as HTMLInputElement | null; if (cb) cb.checked = false; }
      const span = t.nextElementSibling as HTMLElement;
      if (span && t.tagName !== 'SELECT') span.textContent = `${t.value} ${span.textContent!.split(' ').slice(1).join(' ')}`;
    });
    s.appendChild(form);
    const act = document.createElement('div'); act.className = 'jv-actions';
    const ap = document.createElement('button'); ap.className = 'jv-btn'; ap.textContent = 'APPLY';
    ap.onclick = () => this.host.applyWeather({ ...w, source: 'manual' });
    const presets: [string, Partial<WeatherSettings>][] = [
      ['Clear day', { windSpeed: 5, gustSpeed: 0, turbulence: 0.1, visibility: 100000, cloudCover: 'FEW', rain: 0, timeOfDay: 13, realTime: false }],
      ['Scottish showers', { windDirection: 250, windSpeed: 16, gustSpeed: 26, turbulence: 0.45, visibility: 8000, cloudCover: 'BKN', cloudBaseFt: 1800, rain: 0.5 }],
      ['Low cloud and fog', { windSpeed: 3, gustSpeed: 0, turbulence: 0.05, visibility: 800, cloudCover: 'OVC', cloudBaseFt: 600, rain: 0.1 }],
      ['Night', { realTime: false, timeOfDay: 23, cloudCover: 'FEW', visibility: 30000, rain: 0 }],
    ];
    act.appendChild(ap);
    for (const [name, p] of presets) {
      const b = document.createElement('button'); b.className = 'jv-btn ghost'; b.textContent = name.toUpperCase();
      b.onclick = () => { Object.assign(w, p); this.host.applyWeather({ ...w, source: 'manual' }); this.render(); };
      act.appendChild(b);
    }
    s.appendChild(act);
  }

  /** Privacy: what is stored and what leaves the device. Plain facts about this build. */
  private renderPrivacy(s: HTMLElement) {
    s.innerHTML = `<h2>Privacy</h2>
      <h3>On your device</h3>
      <p>JetVault keeps these in your browser's local storage, on your own device only: your graphics and control settings, your JetCoins, your name and your choice about multiplayer. There are no accounts, no cookies and no analytics in the game. Replays are only saved if you press SAVE, as a file you keep.</p>
      <h3>When you open the game</h3>
      <p>Like any website, the server that hosts the game sees your network address when your browser downloads the game's files. The game itself sends nothing else.</p>
      <h3>Multiplayer</h3>
      <p>Multiplayer connects players directly to each other (WebRTC). To introduce them, the free public PeerJS service sees the room code and the network addresses of the people connecting. Everybody in a room can see the others' network addresses, names, aircraft positions and chat messages. Nothing is stored after you leave the room. Only join rooms of people you trust, and do not share anything personal in the chat.</p>
      <h3>Questions</h3>
      <p>Contact details are on the JetVault website (jetvault.net).</p>`;
  }

  /** Help: controls, about, acknowledgements and settings. */
  private renderHelp(s: HTMLElement) {
    s.innerHTML = '<h2>Help</h2><div class="jv-grid"></div>';
    const grid = s.querySelector('.jv-grid') as HTMLElement;
    const items: [Tab, string, string][] = [['controls', 'Controls', 'Keyboard, mouse and touch controls'], ['settings', 'Settings', 'Graphics, controls and sensitivity'], ['about', 'About JetVault', 'Version and what the simulator models'], ['credits', 'Acknowledgements', 'The people whose work is in the game, and the data sources'], ['privacy', 'Privacy', 'What the game stores, and what multiplayer shares']];
    for (const [tab, t, d] of items) { const c = document.createElement('div'); c.className = 'jv-card'; c.innerHTML = `<b>${t}</b><span>${d}</span>`; c.onclick = () => this.go(tab); grid.appendChild(c); }
  }

  /** Multiplayer page: one player hosts a room and shares its 5-letter code, the others join with it. Players see each other's aircraft in the same sky. */
  private mpRoster: HTMLElement | null = null; private mpLog: HTMLElement | null = null;
  private renderMultiplayer(s: HTMLElement) {
    const h = this.host;
    s.innerHTML = `<h2>Multiplayer</h2><p>Fly together in the same sky. One player hosts a room and shares its code, the others join with it (up to 8 players). Everybody flies their own aircraft where they like; you see the others with name tags. Aircraft do not collide with each other. The host's time of day and weather are shared when you join.</p>
      <p class="hint">Connections are made directly between players through the public PeerJS service (it sees the room code and network addresses while connecting). Players behind strict firewalls may not be able to connect.</p>`;
    const row = document.createElement('div'); row.className = 'jv-row';
    let saved = ''; try { saved = localStorage.getItem('jetvault.mpname') ?? ''; } catch { /* ignore */ }
    row.innerHTML = `<label>Your name</label><input type="text" maxlength="16" placeholder="Pilot" value="${saved.replace(/[^\p{L}\p{N} _.\-]/gu, '')}">`;
    const nameIn = row.querySelector('input') as HTMLInputElement; s.appendChild(row);
    const name = () => { const n = nameIn.value.trim() || 'Pilot'; try { localStorage.setItem('jetvault.mpname', n); } catch { /* ignore */ } return n; };
    const st = document.createElement('div'); st.className = 'jv-notice-line';
    const busy = (t: string) => { st.textContent = t; };
    const cons = document.createElement('label'); cons.style.cssText = 'display:flex;gap:10px;align-items:flex-start;margin:6px 0 10px;max-width:640px;font-size:13px;cursor:pointer';
    let agreed = false; try { agreed = localStorage.getItem('jetvault.mpconsent') === '1'; } catch { /* ignore */ }
    cons.innerHTML = `<input type="checkbox" ${agreed ? 'checked' : ''}><span>I understand that the other players in a room, and the public PeerJS connection service, can see my network address, my name, where I fly and what I type. (<a href="#" data-p="1" style="color:#8ab4ff">Privacy</a>)</span>`;
    (cons.querySelector('[data-p]') as HTMLElement).onclick = (e) => { e.preventDefault(); this.go('privacy'); };
    s.appendChild(cons);
    const actions = document.createElement('div'); actions.className = 'jv-row';
    const hostB = document.createElement('button'); hostB.className = 'jv-btn'; hostB.textContent = 'HOST A ROOM';
    hostB.onclick = () => { hostB.disabled = true; busy('Opening a room...'); h.mpHost(name()).then((c) => busy(`Room open. Share this code: ${c}`)).catch((e) => busy(`Could not open a room: ${(e as Error).message}`)).finally(() => { hostB.disabled = false; this.updateMp(); }); };
    const codeIn = document.createElement('input'); codeIn.type = 'text'; codeIn.maxLength = 5; codeIn.placeholder = 'CODE'; codeIn.style.cssText = 'width:90px;text-transform:uppercase;margin-left:18px';
    const joinB = document.createElement('button'); joinB.className = 'jv-btn'; joinB.textContent = 'JOIN';
    joinB.onclick = () => { joinB.disabled = true; busy('Connecting...'); h.mpJoin(codeIn.value.trim().toUpperCase(), name()).then(() => busy('Connected.')).catch((e) => busy((e as Error).message)).finally(() => { joinB.disabled = false; this.updateMp(); }); };
    const leaveB = document.createElement('button'); leaveB.className = 'jv-btn ghost'; leaveB.textContent = 'LEAVE ROOM'; leaveB.onclick = () => { h.mpLeave(); busy('Left the room.'); this.updateMp(); };
    actions.append(hostB, codeIn, joinB, leaveB); s.append(actions, st);
    const gate = () => { hostB.disabled = joinB.disabled = !agreed; hostB.style.opacity = joinB.style.opacity = agreed ? '' : '0.45'; };
    (cons.querySelector('input') as HTMLInputElement).onchange = (e) => { agreed = (e.target as HTMLInputElement).checked; try { localStorage.setItem('jetvault.mpconsent', agreed ? '1' : '0'); } catch { /* ignore */ } gate(); };
    gate();
    const roster = document.createElement('div'); roster.className = 'jv-card'; this.mpRoster = roster; s.appendChild(roster);
    const log = document.createElement('div'); log.className = 'jv-card'; log.style.cssText = 'max-height:160px;overflow:auto;margin-top:10px'; this.mpLog = log; s.appendChild(log);
    const chat = document.createElement('div'); chat.className = 'jv-row';
    const ci = document.createElement('input'); ci.type = 'text'; ci.maxLength = 200; ci.placeholder = 'Message to everybody'; ci.style.width = '60%';
    const send = () => { if (ci.value.trim()) { h.mpSay(ci.value); ci.value = ''; } };
    ci.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); };
    const sb = document.createElement('button'); sb.className = 'jv-btn'; sb.textContent = 'SEND'; sb.onclick = send;
    chat.append(ci, sb); s.appendChild(chat);
    nameIn.onkeydown = (e) => e.stopPropagation(); codeIn.onkeydown = (e) => e.stopPropagation();
    this.updateMp();
  }
  private updateMp() {
    if (!this.mpRoster || !this.mpLog) return;
    const m = this.host.mpState();
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    if (!m) this.mpRoster.innerHTML = '<b>Not in a room</b><span>Host a room or join one with a code.</span>';
    else {
      const rows = m.roster.map((r) => `<div style="display:flex;gap:12px;align-items:center;margin-top:6px"><span>${esc(r.name)}${r.me ? ' (you)' : ''}</span>${r.me ? '' : m.riding === r.id ? '<button class="jv-btn" data-stop="1" style="padding:4px 12px;min-width:0">STOP RIDING</button>' : `<button class="jv-btn ghost" data-ride="${esc(r.id)}" style="padding:4px 12px;min-width:0">RIDE ALONG</button>`}</div>`).join('');
      this.mpRoster.innerHTML = `<b>Room ${m.code ?? ''} ${m.host ? '(you are the host)' : ''}</b>${rows}<span style="margin-top:8px">Ride along: sit in a window seat of another player's aircraft and watch their flight.</span>`;
      this.mpRoster.querySelectorAll<HTMLElement>('[data-ride]').forEach((b) => { b.onclick = () => { this.host.mpRide(b.dataset.ride!); }; });
      const st = this.mpRoster.querySelector<HTMLElement>('[data-stop]'); if (st) st.onclick = () => this.host.mpStopRide();
    }
    this.mpLog.innerHTML = m && m.log.length ? m.log.slice(-30).map((l) => `<div>${esc(l)}</div>`).join('') : '<span>No messages yet.</span>';
    this.mpLog.scrollTop = this.mpLog.scrollHeight;
  }
  /** Director (film mode): a list of scripted shots; the aircraft, weather, time and camera are all automatic, the player just records the screen. */
  private renderDirector(s: HTMLElement) {
    s.innerHTML = '<h2>Director</h2><p>Every shot is fully scripted: aircraft, place, time of day, weather and camera. Start your screen recorder, press START, and the game counts 3-2-1, plays the shot and says CUT. If you missed it, press START AGAIN.</p>';
    const list = document.createElement('div'); list.className = 'jv-grid';
    SHOTS.forEach((sh, i) => {
      const c = document.createElement('div'); c.className = 'jv-card';
      c.innerHTML = `<b>${i + 1}. ${sh.title}</b><span>${sh.duration} s \u00b7 ${sh.cloud} clouds \u00b7 ${Math.floor(sh.timeOfDay)}:${String(Math.round((sh.timeOfDay % 1) * 60)).padStart(2, '0')} UTC</span>`;
      const sel = document.createElement('select'); sel.innerHTML = '<option value="0">Scripted camera</option><option value="1">Orbit camera (you drag the mouse)</option>'; sel.onclick = (e) => e.stopPropagation();
      const b = document.createElement('button'); b.className = 'jv-btn'; b.textContent = 'START'; b.onclick = (e) => { e.stopPropagation(); b.disabled = true; b.textContent = 'LOADING...'; void this.host.directorStart(sh, sel.value === '1'); };
      c.append(sel, b); list.appendChild(c);
    });
    s.appendChild(list);
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
      <label>Far shadows</label><input type="checkbox" data-g="farShadows" ${g.farShadows !== false ? 'checked' : ''}><span></span>
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
      <label>Mouse sensitivity</label><input type="range" min="0.4" max="1.6" step="0.05" value="${stick.sens}" data-sens><span class="val">${Math.round(stick.sens * 100)} %</span>
      <label>Keyboard control rate</label><input type="range" min="0.5" max="4" step="0.1" value="${inp.keyRate}" data-i="keyRate"><span class="val">${inp.keyRate}</span>
      <label>Controller dead zone</label><input type="range" min="0" max="0.3" step="0.01" value="${inp.deadZone}" data-i="deadZone"><span class="val">${inp.deadZone}</span>
      <label>Controller response curve</label><input type="range" min="1" max="3" step="0.1" value="${inp.curve}" data-i="curve"><span class="val">${inp.curve}</span>
      <label>Beginner assists (auto-trim, auto-rudder)</label><input type="checkbox" data-assists ${this.host.assists ? 'checked' : ''}><span class="jv-dim">Turn OFF for realistic mode: nothing moves the controls for you, so the aircraft keeps whatever attitude the forces give it</span>
      <label>Easy flying (GeoFS-style)</label><input type="checkbox" data-arcade ${this.host.arcade ? 'checked' : ''}><span class="jv-dim">Wings level themselves when you release the stick; auto-trim already holds your pitch. Physics unchanged</span>
      <label>Invert pitch axis</label><input type="checkbox" data-i="invertPitch" ${inp.invertPitch ? 'checked' : ''}><span></span>
      <label>Beginner mode: auto-rudder</label><input type="checkbox" data-i="autoRudder" ${inp.autoRudder ? 'checked' : ''}><span class="jv-dim">Moves the pedals: coordinates turns, holds heading on the ground</span>
      <label>Beginner mode: auto-trim</label><input type="checkbox" data-i="autoTrim" ${inp.autoTrim ? 'checked' : ''}><span class="jv-dim">Holds level flight / vertical speed when you release the stick (moves the trim)</span>
      <label>Axis: pitch / roll / yaw / throttle</label><input type="text" data-i="axes" value="${inp.axes.pitch},${inp.axes.roll},${inp.axes.yaw},${inp.axes.throttle}"><span class="jv-dim">Gamepad API axis indices for your joystick or yoke</span>`;
    c.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.hasAttribute('data-sens')) { stick.sens = parseFloat(t.value); saveStickSens(); if (t.nextElementSibling) t.nextElementSibling.textContent = `${Math.round(stick.sens * 100)} %`; return; }
      if (t.hasAttribute('data-assists')) { this.host.setAssists(t.checked); return; }
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
