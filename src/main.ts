// JetVault Flight Simulator - browser entry point.

import * as THREE from 'three';
import { loadWorld, World, LandCover } from './world/world';
import { Simulation, SpawnKind } from './sim/simulation';
import { C172 } from './sim/aircraft/c172';
import { B738 } from './sim/aircraft/b738';
import { AircraftDef } from './sim/fdm/aircraft';
import { B737Model } from './render/b737Model';
import { B737Cockpit } from './render/b737Cockpit';
import { DEFAULT_WEATHER, WeatherSettings } from './sim/weather';
import { TerrainRenderer } from './render/terrainMesh';
import { AirportRenderer, buildPavementOverlay, buildRoadOverlay } from './render/airportMesh';
import { BuildingsRenderer } from './render/buildingsMesh';
import { C172Model } from './render/c172Model';
import { Cockpit } from './render/cockpit';
import { EnvironmentRenderer } from './render/environment';
import { CameraRig, ViewMode } from './render/cameras';
import { DebugView } from './render/debugView';
import { bodyMatrix, nedToThree } from './render/coords';
import { InputManager, loadInputSettings, Action } from './input/input';
import { Hud } from './ui/hud';
import { Menu, MenuHost, GraphicsSettings, loadGraphics } from './ui/menu';
import { Vec3 } from './core/math';

const loadingMsg = document.getElementById('loading-msg')!;
const loadingBar = document.getElementById('loading-bar')!;
let step = 0;
const progress = (m: string) => { step++; loadingMsg.textContent = m; loadingBar.style.width = `${Math.min(100, step * 11)}%`; };

async function fetchBuf(path: string) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.arrayBuffer();
}

async function decodeGray(buf: ArrayBuffer, n: number) {
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(n, n);
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, n, n).data;
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = px[i * 4];
  return out;
}

class App implements MenuHost {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  sim!: Simulation;
  world!: World;
  terrain!: TerrainRenderer;
  airport!: AirportRenderer;
  buildings!: BuildingsRenderer;
  model!: C172Model | B737Model;
  cockpit!: Cockpit | B737Cockpit;
  aircraftDefs: AircraftDef[] = [C172, B738];
  env!: EnvironmentRenderer;
  rig!: CameraRig;
  debug!: DebugView;
  hud!: Hud;
  menu!: Menu;
  input!: InputManager;
  aircraftGroup = new THREE.Group();
  graphics: GraphicsSettings = loadGraphics();
  weather: WeatherSettings = { ...DEFAULT_WEATHER };
  payload: number[] = [];
  fuelFraction: [number, number] = [1, 1];
  attribution: string[] = [];
  private lastSpawn: SpawnKind | { kind: 'air'; east: number; north: number; altFt: number; hdg: number } | null = null;
  private started = false;
  private lastT = 0;
  private perfEl: HTMLDivElement | null = null;
  private frameTimes: number[] = [];
  private raycaster = new THREE.Raycaster();
  private drag: { x: number; y: number; button: number; knob: THREE.Object3D | null; moved: boolean } | null = null;
  private tipEl = document.createElement('div');
  private autoStart: { t: number } | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.graphics.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.graphics.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('app')!.appendChild(this.renderer.domElement);
    this.tipEl.className = 'jv-tip';
    this.tipEl.style.display = 'none';
    document.body.appendChild(this.tipEl);
  }

  get aircraft() { return this.sim.aircraft; }
  get inputSettings() { return this.input.settings; }

  async init() {
    progress('Loading region data');
    this.world = await loadWorld('./data/egph', fetchBuf, decodeGray, progress);
    this.attribution = this.world.meta.attribution;
    this.sim = new Simulation(this.world, C172, this.weather);
    this.payload = C172.stations.map((s) => s.mass);
    progress('Building terrain');
    const overlay = buildPavementOverlay(this.world.airport);
    const lcLoBuf = await fetchBuf(`./data/egph/${this.world.meta.landcoverLo.file}`);
    const lcLo = await decodeGray(lcLoBuf, this.world.meta.landcoverLo.n);
    const lo = new LandCover(lcLo, this.world.meta.landcoverLo.n, this.world.meta.landcoverLo.half, this.world.meta.landcoverLo.step);
    let roads = null;
    try { roads = buildRoadOverlay(JSON.parse(new TextDecoder().decode(await fetchBuf('./data/egph/roads.json')))); } catch { /* optional data */ }
    let imagery = null;
    try {
      progress('Satellite imagery (Copernicus Sentinel-2)');
      const t = await new THREE.TextureLoader().loadAsync('./data/egph/imagery.jpg');
      t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; // image row 0 = north = v 1 (flipY default)
      imagery = { texture: t, e0: -12000, n0: -12000, size: 24000 };
    } catch { /* optional data */ }
    this.terrain = new TerrainRenderer(this.world.terrain.hi, this.world.terrain.lo, this.world.landcover, lo, overlay, roads, imagery);
    this.scene.add(this.terrain.group);
    progress('Building airport');
    this.airport = new AirportRenderer(this.world.airport, this.world.terrain);
    this.scene.add(this.airport.group);
    progress('Building city');
    this.buildings = new BuildingsRenderer(this.world.obstacles.buildings);
    this.scene.add(this.buildings.group);
    progress('Building aircraft');
    this.buildAircraftVisuals();
    this.aircraftGroup.matrixAutoUpdate = false;
    this.scene.add(this.aircraftGroup);
    this.env = new EnvironmentRenderer(this.scene, this.renderer, this.terrain.uniforms.uDetail.value as THREE.DataTexture);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.eye.set(this.sim.def.eye.x, this.sim.def.eye.y, this.sim.def.eye.z);
    this.placeTower();
    this.debug = new DebugView(this.sim.aircraft, this.world);
    this.scene.add(this.debug.group);
    this.input = new InputManager(loadInputSettings(), this.renderer.domElement);
    this.hud = new Hud();
    this.applyGraphics(this.graphics);
    this.bindPointer();
    window.addEventListener('resize', () => this.resize());
    // initial state behind the menu: parked at stand 1
    this.sim.spawn({ kind: 'stand', index: 0, coldAndDark: false });
    this.sim.paused = true;
    progress('Ready');
    this.menu = new Menu(this);
    const ld = document.getElementById('loading')!;
    ld.style.opacity = '0';
    setTimeout(() => ld.remove(), 700);
    this.renderer.setAnimationLoop(() => this.frame());
    this.lastT = performance.now();
    (window as any).jetvault = this; // console access for development and automated checks
  }

  /** The control tower is the tallest structure at EGPH: use the tallest airport building. */
  private placeTower() {
    const ob = this.world.obstacles;
    let best = -1, bestH = 0;
    for (const id of ob.query(-2500, -2500, 2500, 2500)) {
      const b = ob.buildings[id];
      if (b.top - b.base > bestH) { bestH = b.top - b.base; best = id; }
    }
    if (best >= 0) {
      const b = ob.buildings[best];
      this.rig.towerPos.set((b.minE + b.maxE) / 2, b.top + 3, -(b.minN + b.maxN) / 2);
    }
  }

  private buildAircraftVisuals() {
    if (this.model) this.aircraftGroup.remove(this.model.root);
    if (this.cockpit) this.aircraftGroup.remove(this.cockpit.root);
    const jet = this.sim.def.id === 'b738';
    this.model = jet ? new B737Model() : new C172Model();
    this.cockpit = jet ? new B737Cockpit(this.sim, this.world.airport) : new Cockpit(this.sim);
    this.aircraftGroup.add(this.model.root, this.cockpit.root);
    if (this.rig) {
      this.rig.eye.set(this.sim.def.eye.x, this.sim.def.eye.y, this.sim.def.eye.z);
      this.rig.chaseDist = jet ? 60 : 16;
      this.rig.headPitch = jet ? -0.32 : -0.2;
      if (jet) this.rig.wingCam.set(-6, -21, -2.5); else this.rig.wingCam.set(-1.2, -6.6, -1.6);
    }
    if (this.debug) { this.scene.remove(this.debug.group); this.debug = new DebugView(this.sim.aircraft, this.world); this.scene.add(this.debug.group); }
  }

  /** Switch aircraft type (rebuilds the simulation and the aircraft visuals). */
  selectAircraft(id: string) {
    if (this.sim.def.id === id) return;
    const def = this.aircraftDefs.find((d) => d.id === id)!;
    this.sim = new Simulation(this.world, def, this.weather);
    this.payload = def.stations.map((st) => st.mass);
    this.fuelFraction = id === 'b738' ? [0.45, 0.45] : [1, 1];
    this.buildAircraftVisuals();
  }

  // ---------------------------------------------------------------- MenuHost
  startView: 'cockpit' | 'chase' = 'cockpit';

  fly(spawn: SpawnKind | { kind: 'air'; east: number; north: number; altFt: number; hdg: number }) {
    const ac = this.sim.aircraft;
    ac.payload = [...this.payload];
    ac.fuel = ac.def.tanks.map((t, i) => t.capacity * this.fuelFraction[i]);
    ac.updateMass();
    if (spawn.kind === 'air') this.sim.spawnAir(spawn.east, spawn.north, spawn.altFt, spawn.hdg);
    else this.sim.spawn(spawn);
    this.lastSpawn = JSON.parse(JSON.stringify(spawn));
    this.sim.paused = false;
    this.started = true;
    this.rig.setMode(this.startView, ac);
    this.menu.hide();
    this.renderer.domElement.focus();
  }
  resume() { this.sim.paused = false; this.menu.hide(); }
  canResume() { return this.started && !this.sim.aircraft.crashed; }
  applyWeather(w: WeatherSettings) { this.weather = w; this.sim.setWeather(w); this.hud?.toast('Weather applied'); }
  applyGraphics(g: GraphicsSettings) {
    this.graphics = g;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * g.renderScale);
    this.renderer.shadowMap.enabled = g.shadows;
    this.env.sun.castShadow = g.shadows;
    this.terrain.detail = g.terrainDetail;
    this.buildings.maxDistance = g.buildingDistanceKm * 1000;
  }

  private resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- input
  private bindPointer() {
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const ndc = (e: MouseEvent) => new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    el.addEventListener('pointerdown', (e) => {
      let knob: THREE.Object3D | null = null;
      if (this.rig.mode === 'cockpit' && e.button === 0) {
        this.raycaster.setFromCamera(ndc(e), this.rig.camera);
        const hits = this.raycaster.intersectObjects([this.cockpit.panelMesh, ...this.cockpit.knobs], false);
        if (hits.length) {
          const h = hits[0];
          if (h.object === this.cockpit.panelMesh && h.uv) {
            const r = this.cockpit.interact(h.uv, 'down');
            if (r) { this.hud.toast(r.tip, 1.5); return; }
          } else knob = h.object;
        }
      }
      this.drag = { x: e.clientX, y: e.clientY, button: e.button, knob, moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        this.drag.moved = true;
        if (this.drag.knob) {
          const c = this.sim.controls;
          const key = this.drag.knob.name as 'throttle' | 'mixture';
          c[key] = THREE.MathUtils.clamp(c[key] - dy * 0.004, 0, 1);
        } else this.rig.look(dx, dy);
        return;
      }
      if (this.rig.mode === 'cockpit') {
        this.raycaster.setFromCamera(ndc(e), this.rig.camera);
        const hits = this.raycaster.intersectObjects([this.cockpit.panelMesh, ...this.cockpit.knobs], false);
        let tip = '';
        if (hits.length && hits[0].object === this.cockpit.panelMesh && hits[0].uv) tip = this.cockpit.interact(hits[0].uv, 'move')?.tip ?? '';
        else if (hits.length) tip = `${hits[0].object.name} (drag up/down)`;
        else this.cockpit.hover = null;
        el.style.cursor = tip ? 'pointer' : 'default';
        this.tipEl.style.display = tip ? '' : 'none';
        this.tipEl.textContent = tip;
        this.tipEl.style.left = `${e.clientX + 14}px`; this.tipEl.style.top = `${e.clientY + 14}px`;
      }
    });
    el.addEventListener('pointerup', (e) => {
      this.cockpit.releaseAll();
      this.drag = null;
      el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.rig.mode === 'cockpit' && this.cockpit.hover) {
        this.raycaster.setFromCamera(ndc(e), this.rig.camera);
        const h = this.raycaster.intersectObject(this.cockpit.panelMesh, false)[0];
        if (h?.uv) { this.cockpit.interact(h.uv, 'wheel', e.deltaY < 0 ? 1 : -1); return; }
      }
      this.rig.zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  private handleAction(a: Action) {
    const sim = this.sim, c = sim.controls, ac = sim.aircraft, ap = sim.autopilot;
    const views: Partial<Record<Action, ViewMode>> = { viewCockpit: 'cockpit', viewChase: 'chase', viewWing: 'wing', viewTower: 'tower', viewFree: 'free' };
    if (views[a]) { this.rig.setMode(views[a]!, ac); return; }
    switch (a) {
      case 'menu': if (this.menu.open) { if (this.canResume()) this.resume(); } else { this.sim.paused = true; this.menu.show(); } break;
      case 'pause': sim.paused = !sim.paused; break;
      case 'simRate': sim.timeScale = sim.timeScale >= 4 ? 1 : sim.timeScale * 2; this.hud.toast(`Simulation rate ${sim.timeScale}x`); break;
      case 'flapsUp': c.flapLever = Math.max(0, c.flapLever - 1); break;
      case 'flapsDown': c.flapLever = Math.min(ac.def.controls.flapDetents.length - 1, c.flapLever + 1); break;
      case 'gearToggle': if (ac.def.retractableGear) { c.gearDown = !c.gearDown; this.hud.toast(c.gearDown ? 'Gear down' : 'Gear up'); } break;
      case 'speedbrake': c.speedbrake = c.speedbrake > 0.5 ? 0 : 1; this.hud.toast(c.speedbrake ? 'Speedbrake extended' : 'Speedbrake retracted'); break;
      case 'throttleFull': c.throttle = 1; break;
      case 'throttleIdle': c.throttle = 0; break;
      case 'parkingBrake': c.parkingBrake = !c.parkingBrake; this.hud.toast(c.parkingBrake ? 'Parking brake set' : 'Parking brake released'); break;
      case 'autoStart': this.autoStart = { t: 0 }; this.hud.toast('Automatic start sequence'); break;
      case 'apToggle': if (ap.engaged) ap.disengage('Pilot'); else ap.engage(sim.systems); this.hud.toast(ap.engaged ? 'Autopilot engaged (ROL / VS)' : `Autopilot off ${ap.disconnectReason}`); break;
      case 'apHdg': if (ap.engaged) ap.lateral = ap.lateral === 'HDG' ? 'ROL' : 'HDG'; break;
      case 'apAlt': if (ap.engaged) { if (ap.vertical === 'ALT') ap.vertical = 'VS'; else ap.holdAltitude(sim.systems); } break;
      case 'apUp': if (ap.vertical === 'VS') ap.targetVsFpm += 100; else ap.targetAltFt += 100; break;
      case 'apDown': if (ap.vertical === 'VS') ap.targetVsFpm -= 100; else ap.targetAltFt -= 100; break;
      case 'hdgBugSync': c.headingBug = Math.round(sim.systems.ind.headingDeg); break;
      case 'debugCollision': this.debug.toggle(); break;
      case 'perfOverlay': this.togglePerf(); break;
      case 'hud': this.hud.toggle(); break;
      case 'mouseYoke': this.input.mouseYoke = !this.input.mouseYoke; this.hud.toast(this.input.mouseYoke ? 'Mouse yoke on' : 'Mouse yoke off'); break;
      case 'reset': if (this.lastSpawn) this.fly(this.lastSpawn); break;
      case 'zoomIn': this.rig.zoom(1); break;
      case 'zoomOut': this.rig.zoom(-1); break;
      default: break;
    }
  }

  /** Automatic start: performs the same switch actions a pilot would, in order. */
  private runAutoStart(dt: number) {
    if (!this.autoStart) return;
    const c = this.sim.controls, eng = this.sim.aircraft.engine;
    const s = this.autoStart;
    s.t += dt;
    c.masterBattery = true; c.beacon = true; c.fuelSelector = 'BOTH'; c.mixture = 1;
    if (s.t < 0.5) { c.throttle = 0.1; return; }
    if (!eng.running && s.t < 10) { c.mags = 'START'; return; }
    c.mags = 'BOTH';
    c.masterAlternator = true; c.avionics = true; c.navLights = true;
    c.throttle = 0.12;
    this.hud.toast(eng.running ? 'Engine running' : 'Engine did not start');
    this.autoStart = null;
  }

  /** Flight-control diagnostics (part of the F10 overlay). */
  private diagnostics() {
    const ac = this.sim.aircraft, c = this.sim.controls, R = 180 / Math.PI;
    const eff = this.sim.autopilot.effectiveControls(c);
    const vb = ac.q.invRotate(ac.vel);
    const w = this.sim.wind.windAt(Math.max(ac.agl, 0));
    const wDir = ((Math.atan2(-w.y, -w.x) * R) + 360) % 360;
    const gear = ac.def.gear.map((g, i) => {
      const s = ac.gearStates[i];
      return `  ${g.name.padEnd(11)} N ${(s.force / 1000).toFixed(2).padStart(6)} kN  side ${(s.lateralForce / 1000).toFixed(2).padStart(6)} kN${s.contact ? '' : ' (air)'}`;
    }).join('\n');
    return `--- controls / state ---\n` +
      `Pedals in   ${eff.yaw.toFixed(3)} (assist ${this.input.assistYaw.toFixed(3)})\n` +
      `Rudder      ${(ac.rudder * R).toFixed(2)} deg   Nose steer ${((ac.gearStates[0]?.steer ?? 0) * R).toFixed(2)} deg\n` +
      `Aileron L/R ${(ac.aileronL * R).toFixed(2)} / ${(ac.aileronR * R).toFixed(2)} deg  (stick ${eff.roll.toFixed(3)})\n` +
      `Elevator    ${(ac.elevator * R).toFixed(2)} deg  trim ${c.trim.toFixed(2)}\n` +
      `Yaw rate    ${(ac.q.rotate(ac.omega).z * R).toFixed(2)} deg/s  Roll rate ${(ac.omega.x * R).toFixed(2)} deg/s\n` +
      `Sideslip    ${(ac.beta * R).toFixed(2)} deg  Lateral vel ${vb.y.toFixed(2)} m/s\n` +
      `Wind        ${wDir.toFixed(0)} deg / ${(Math.hypot(w.x, w.y) / 0.5144).toFixed(1)} kt\n` +
      `CG offset   y ${ac.cg.y.toFixed(3)} m  mass ${ac.mass.toFixed(0)} kg\n` +
      `Thrust      ${(ac.engines.reduce((a, e) => a + e.thrust, 0) / 1000).toFixed(2)} kN\n` + gear;
  }

  private togglePerf() {
    if (this.perfEl) { this.perfEl.remove(); this.perfEl = null; return; }
    this.perfEl = document.createElement('div');
    this.perfEl.className = 'jv-perf';
    document.body.appendChild(this.perfEl);
  }

  // ---------------------------------------------------------------- frame
  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    const t0 = performance.now();
    const sim = this.sim, ac = sim.aircraft;
    for (const a of this.input.consume()) this.handleAction(a);
    if (!this.menu.open) {
      this.input.update(dt, sim.controls, ac.beta, ac.onGround, ac.euler[2], ac.q.rotate(ac.omega).z, Math.hypot(ac.vel.x, ac.vel.y));
      this.runAutoStart(dt);
    }
    sim.advance(dt);

    // aircraft transform (model authored in the body frame, origin at the datum)
    const R = bodyMatrix(ac.q);
    R.setPosition(nedToThree(ac.worldPoint(new Vec3(0, 0, 0))));
    this.aircraftGroup.matrix.copy(R);
    this.aircraftGroup.matrixWorldNeedsUpdate = true;

    this.rig.update(ac, dt);
    const cam = this.rig.camera;
    const inCockpit = this.rig.mode === 'cockpit';
    this.model.setCockpitView(inCockpit);
    this.cockpit.root.visible = inCockpit;
    const focus = nedToThree(ac.pos);
    this.env.update(sim.weather, sim.simTime, cam.position, focus);
    for (const m of this.scene.children) if (m.renderOrder >= 2 && m.renderOrder <= 3) m.visible = m.visible && this.graphics.clouds;
    this.model.update(ac, sim.controls, sim.paused ? 0 : dt * sim.timeScale, this.env.night);
    if (inCockpit) this.cockpit.update(dt, this.env.night);
    this.terrain.update(cam.position, sim.simTime);
    this.terrain.setNight(this.env.night);
    this.terrain.setWet(sim.weather.rain > 0.1 ? Math.min(1, sim.weather.rain * 1.5) : 0);
    this.airport.update(cam.position, this.env.lightLevel, window.innerHeight / 1000);
    this.buildings.update(cam.position, this.env.night);
    this.debug.update();
    this.hud.update(sim, dt, this.rig.mode);
    if (this.menu.open) this.menu.drawMap();

    this.renderer.toneMappingExposure = this.env.tune.exposure;
    this.renderer.render(this.scene, cam);
    const frameMs = performance.now() - t0;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.perfEl) {
      const fps = this.frameTimes.length / this.frameTimes.reduce((a, b) => a + b, 0);
      const info = this.renderer.info;
      this.perfEl.textContent =
        `FPS          ${fps.toFixed(1)}\nCPU frame    ${frameMs.toFixed(1)} ms\nPhysics      ${sim.physicsMs.toFixed(2)} ms (${sim.stepsLastFrame} steps @240 Hz)\n` +
        `Draw calls   ${info.render.calls}\nTriangles    ${(info.render.triangles / 1e6).toFixed(2)} M\nTerrain tris ${(this.terrain.trianglesDrawn / 1e6).toFixed(2)} M\n` +
        `Geometries   ${info.memory.geometries}  Textures ${info.memory.textures}\n` + this.diagnostics();
    }
  }
}

const app = new App();
app.init().catch((e) => {
  console.error(e);
  loadingMsg.textContent = `Failed to start: ${e.message}`;
  loadingMsg.style.color = '#e5484d';
});
