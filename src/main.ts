// JetVault Flight Simulator - browser entry point.

import * as THREE from 'three';
import { loadWorld, World, LandCover } from './world/world';
import { Simulation, SpawnKind } from './sim/simulation';
import { C172 } from './sim/aircraft/c172';
import { B738 } from './sim/aircraft/b738';
import { GLIDER } from './sim/aircraft/glider';
import { GliderModel, GliderCockpit } from './render/gliderModel';
import { Vario } from './ui/vario';
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
import { CameraRig } from './render/cameras';
import { DebugView } from './render/debugView';
import { bodyMatrix, nedToThree } from './render/coords';
import { InputManager, loadInputSettings } from './input/input';
import { Hud } from './ui/hud';
import { Menu, MenuHost, GraphicsSettings, loadGraphics } from './ui/menu';
import { Vec3, clamp } from './core/math';
import { AutoTrim } from './sim/assists';
import { SimpleControls, IS_TOUCH } from './input/simpleControls';
import { Minimap } from './ui/minimap';
import { JetBridges } from './render/jetBridges';
import { CrashFx } from './render/crashFx';

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
  model!: C172Model | B737Model | GliderModel;
  cockpit!: Cockpit | B737Cockpit | GliderCockpit;
  aircraftDefs: AircraftDef[] = [C172, B738, GLIDER];
  env!: EnvironmentRenderer;
  rig!: CameraRig;
  debug!: DebugView;
  hud!: Hud;
  menu!: Menu;
  input!: InputManager;
  aircraftGroup = new THREE.Group();
  private crashFx!: CrashFx;
  private jetBridges!: JetBridges;
  private bridgeBtn!: HTMLButtonElement;
  private parkBtn!: HTMLButtonElement;
  private pushBtn!: HTMLButtonElement;
  private launchBtn!: HTMLButtonElement;
  private vario!: Vario;
  private cableLine!: THREE.Line;
  private tug!: THREE.Group;
  private tugCab!: THREE.Mesh;
  private tugDash!: THREE.Group;
  private pushing = false;
  private prevView: 'cockpit' | 'chase' = 'chase';
  private lastVel = new THREE.Vector3();
  private crashShown = false;
  graphics: GraphicsSettings = loadGraphics();
  weather: WeatherSettings = { ...DEFAULT_WEATHER };
  payload: number[] = [];
  fuelFraction: [number, number] = [1, 1];
  attribution: string[] = [];
  private started = false;
  private lastT = 0;
  private perfEl: HTMLDivElement | null = null;
  private frameTimes: number[] = [];
  private tipEl = document.createElement('div');
  private autoTrim = new AutoTrim();
  simple!: SimpleControls;
  minimap: Minimap | null = null;

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
    let roadsJson: [string, [number, number][]][] | null = null;
    try { roadsJson = JSON.parse(new TextDecoder().decode(await fetchBuf('./data/egph/roads.json'))); roads = buildRoadOverlay(roadsJson!); } catch { /* optional data */ }
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
    this.jetBridges = new JetBridges(this.world.airport.gates ?? [], this.world.obstacles.buildings, (e, n) => this.world.terrain.heightAt(e, n) - 0.2);
    this.scene.add(this.jetBridges.group);
    this.bridgeBtn = document.createElement('button');
    this.bridgeBtn.className = 'jv-bridge';
    this.bridgeBtn.style.display = 'none';
    document.body.appendChild(this.bridgeBtn);
    this.bridgeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.handleSimple('bridge'); });
    this.launchBtn = document.createElement('button');
    this.launchBtn.className = 'jv-bridge';
    this.launchBtn.style.display = 'none';
    document.body.appendChild(this.launchBtn);
    this.launchBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.handleSimple('launch'); });
    this.vario = new Vario();
    this.cableLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xffc830 }));
    this.cableLine.frustumCulled = false; this.cableLine.visible = false;
    this.scene.add(this.cableLine);
    this.pushBtn = document.createElement('button');
    this.pushBtn.className = 'jv-bridge';
    this.pushBtn.style.cssText = 'display:none;top:112px';
    document.body.appendChild(this.pushBtn);
    this.pushBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.handleSimple('push'); });
    // Pushback tug in the aircraft body frame (FRD); the group origin is the nose gear and +x points away from the aircraft.
    this.tug = new THREE.Group();
    this.tug.position.set(14.1, 0, 0);
    {
      const m = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6 }), d = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.8 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 1.2), m); body.position.set(5.7, 0, 3.2);
      const wheels = [-1.0, 1.0].flatMap((sy) => [4.0, 7.4].map((sx) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 14), d); w.rotation.x = Math.PI / 2; w.position.set(sx, sy * 1.25, 3.55); return w; }));
      this.tugCab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.0, 1.6), d); this.tugCab.position.set(4.5, 0, 2.0);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.18), d); bar.position.set(1.6, 0, 3.4);
      // driver's dashboard and wheel, shown only in the tug view
      this.tugDash = new THREE.Group();
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.5), d); dash.position.set(3.2, 0, 2.2);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 20), d); wheel.rotation.y = Math.PI / 2; wheel.position.set(3.45, 0.5, 1.9);
      this.tugDash.add(dash, wheel);
      this.tugDash.visible = false;
      this.tug.add(body, ...wheels, this.tugCab, bar, this.tugDash);
      this.tug.visible = false;
      this.aircraftGroup.add(this.tug);
    }
    this.parkBtn = document.createElement('button');
    this.parkBtn.className = 'jv-park';
    document.body.appendChild(this.parkBtn);
    this.parkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.handleSimple('park'); });
    progress('Building aircraft');
    this.buildAircraftVisuals();
    this.aircraftGroup.matrixAutoUpdate = false;
    this.scene.add(this.aircraftGroup);
    this.crashFx = new CrashFx(this.scene);
    this.env = new EnvironmentRenderer(this.scene, this.renderer, this.terrain.uniforms.uDetail.value as THREE.DataTexture);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.eye.set(this.sim.def.eye.x, this.sim.def.eye.y, this.sim.def.eye.z);
    this.placeTower();
    this.debug = new DebugView(this.sim.aircraft, this.world);
    this.scene.add(this.debug.group);
    this.input = new InputManager(loadInputSettings(), this.renderer.domElement);
    this.simple = new SimpleControls(this.renderer.domElement);
    this.minimap = new Minimap(this.world.airport, (imagery?.texture.image as CanvasImageSource) ?? null, roadsJson);
    if (IS_TOUCH) {
      // phones / tablets: lighter rendering
      this.graphics = { ...this.graphics, renderScale: Math.min(this.graphics.renderScale, 0.75), shadows: false, buildingDistanceKm: 5, terrainDetail: 0.7 };
      document.body.classList.add('touch');
    }
    this.hud = new Hud();
    this.applyGraphics(this.graphics);
    this.renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); this.rig.zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    this.bindTouchLook(this.renderer.domElement);
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
    const glider = !!this.sim.def.glider;
    this.model = glider ? new GliderModel() : jet ? new B737Model() : new C172Model();
    this.cockpit = glider ? new GliderCockpit() : jet ? new B737Cockpit(this.sim, this.world.airport) : new Cockpit(this.sim);
    this.aircraftGroup.add(this.model.root, this.cockpit.root);
    if (this.rig) {
      this.rig.eye.set(this.sim.def.eye.x, this.sim.def.eye.y, this.sim.def.eye.z);
      this.rig.chaseDist = jet ? 60 : glider ? 24 : 16;
      this.rig.headPitch = jet ? -0.32 : -0.2;
      if (jet) this.rig.wingCam.set(-6, -21, -2.5); else if (glider) this.rig.wingCam.set(-0.5, -9.5, -1.0); else this.rig.wingCam.set(-1.2, -6.6, -1.6);
    }
    if (this.debug) { this.scene.remove(this.debug.group); this.debug = new DebugView(this.sim.aircraft, this.world); this.scene.add(this.debug.group); }
  }

  /** Switch aircraft type (rebuilds the simulation and the aircraft visuals). */
  selectAircraft(id: string) {
    if (this.sim.def.id === id) return;
    const def = this.aircraftDefs.find((d) => d.id === id)!;
    this.sim = new Simulation(this.world, def, this.weather);
    this.sim.paused = true; // the new aircraft is not placed until a start position is chosen
    this.payload = def.stations.map((st) => st.mass);
    this.fuelFraction = id === 'b738' ? [0.45, 0.45] : [1, 1];
    this.sim.lift.strength = 1;
    this.buildAircraftVisuals();
  }

  /** One-finger swipe orbits/looks, two-finger pinch zooms (touch controls sit above the canvas). */
  private bindTouchLook(el: HTMLCanvasElement) {
    el.style.touchAction = 'none';
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0; });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) this.rig.look(dx, dy);
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) { const r = d / pinch; if (Math.abs(r - 1) > 0.01) this.rig.zoom(r > 1 ? 1 : -1); }
        pinch = d;
      }
    });
    const end = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- MenuHost
  startView: 'cockpit' | 'chase' = 'chase';

  fly(spawn: SpawnKind | { kind: 'air'; east: number; north: number; altFt: number; hdg: number }) {
    const ac = this.sim.aircraft;
    ac.payload = [...this.payload];
    ac.fuel = ac.def.tanks.map((t, i) => t.capacity * this.fuelFraction[i]);
    ac.updateMass();
    if (spawn.kind === 'air') this.sim.spawnAir(spawn.east, spawn.north, spawn.altFt, spawn.hdg);
    else this.sim.spawn(spawn);
    this.crashFx.clear();
    this.sim.aircraft.tugSpeed = null;
    if (this.tug && this.pushing) this.finishPushback();
    if (this.tug) this.tug.visible = false;
    this.crashShown = false;
    this.aircraftGroup.visible = true;
    this.simple.setThrottle(this.sim.controls.throttle);
    this.simple.parking = this.sim.controls.parkingBrake;
    this.autoTrim = new AutoTrim();
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

  /** Simplified control events (keys G/F/B/C/Esc or touch buttons). */
  private handleSimple(ev: string) {
    const c = this.sim.controls, ac = this.sim.aircraft;
    if (ev === 'menu') { if (this.menu.open) { if (this.canResume()) this.resume(); } else { this.sim.paused = true; this.menu.show(); } return; }
    if (this.menu.open) return;
    if (ev === 'gear' && ac.def.retractableGear) { c.gearDown = !c.gearDown; this.hud.toast(c.gearDown ? 'Gear down' : 'Gear up'); }
    if (ev === 'gear' && !ac.def.retractableGear) this.hud.toast('Fixed landing gear');
    if (ev === 'flaps') {
      const det = ac.def.controls.flapDetents;
      c.flapLever = (Math.round(c.flapLever) + 1) % det.length;
      this.hud.toast(`Flaps ${Math.round((det[c.flapLever] * 180) / Math.PI)}`);
    }
    if (ev === 'spoilers') { c.speedbrake = c.speedbrake > 0.5 ? 0 : 1; this.hud.toast(c.speedbrake ? 'Spoilers extended' : 'Spoilers retracted'); }
    if (ev === 'bridge') {
      const msg = this.jetBridges.toggle(ac);
      if (this.jetBridges.connected) this.simple.parking = true; // park the aircraft when the bridge connects
      this.hud.toast(msg);
    }
    if (ev === 'push') {
      if (this.pushing) { this.finishPushback(); this.hud.toast('Back in the aircraft'); }
      else if (!ac.def.retractableGear || !ac.onGround || Math.hypot(ac.vel.x, ac.vel.y) > 0.5) this.hud.toast('Pushback needs a stopped airliner on the ground');
      else if (this.jetBridges.connected) this.hud.toast('Retract the jet bridge first');
      else {
        this.pushing = true;
        this.prevView = this.rig.mode === 'cockpit' ? 'cockpit' : 'chase';
        this.simple.tugMode = true; this.simple.tugSteer = 0; this.simple.parking = false; this.simple.setThrottle(0);
        ac.tugSpeed = 0; ac.tugSteer = 0;
        this.tug.visible = true; this.tugCab.visible = false; this.tugDash.visible = true;
        this.rig.setMode('cockpit', ac); this.rig.tug.on = true; this.rig.headYaw = 0; this.rig.headPitch = -0.1;
        this.hud.toast('You are the tug driver: 1-9 speed (1 = stop), steer with mouse/arrows (the wheel stays turned; Up = straight), Space brakes');
      }
    }
    if (ev === 'launch') {
      if (!ac.def.glider) this.hud.toast('Launch is for gliders');
      else if (ac.cable) { this.sim.releaseCable(); this.hud.toast('Cable released'); }
      else if (this.sim.startWinch()) this.hud.toast('Winch launch: hold the stick back gently, release the cable at the top (R or the button)');
      else this.hud.toast('Stop on the ground to start a winch launch');
    }
    if (ev === 'park') { this.simple.parking = !this.simple.parking; this.hud.toast(this.simple.parking ? 'Parking brake ON' : 'Parking brake OFF'); }
    if (ev === 'camera') this.rig.setMode(this.rig.mode === 'cockpit' ? 'chase' : 'cockpit', ac);
  }

  private finishPushback() {
    this.pushing = false;
    const ac = this.sim.aircraft;
    ac.tugSpeed = null; ac.tugSteer = 0;
    this.tug.visible = false; this.tugCab.visible = true; this.tugDash.visible = false;
    this.simple.tugMode = false; this.simple.parking = true; this.simple.setThrottle(0.1);
    this.rig.tug.on = false;
    this.rig.setMode(this.prevView, ac);
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



  // ---------------------------------------------------------------- frame
  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    const t0 = performance.now();
    const sim = this.sim, ac = sim.aircraft;
    this.input.consume(); // legacy bindings are disabled in the simplified control scheme
    for (const ev of this.simple.consume()) this.handleSimple(ev);
    if (!this.menu.open) {
      this.simple.update(dt, sim.controls, ac);
      if (!sim.paused) sim.controls.pitch = clamp(sim.controls.pitch + this.autoTrim.update(dt * sim.timeScale, ac, sim.controls, this.simple.rawPitch), -1, 1);
    }
    if (!ac.crashed) nedToThree(ac.vel, this.lastVel);
    sim.advance(dt);
    if (ac.crashed && !this.crashShown) {
      this.crashShown = true;
      this.aircraftGroup.visible = false;
      this.rig.setMode('chase', ac);
      this.crashFx.trigger(nedToThree(ac.pos), this.lastVel.clone(), nedToThree(ac.pos).y - Math.max(ac.agl, 0), ac.def === B738 ? 35.8 : 11, 0xe9edf3);
    }
    this.crashFx.update(dt);
    this.jetBridges.update(dt, ac);
    const showBridge = !this.menu.open && !ac.crashed && !this.pushing && this.jetBridges.canConnect(ac);
    this.bridgeBtn.style.display = showBridge ? 'block' : 'none';
    if (this.pushing) {
      if (!ac.onGround) this.finishPushback();
      else { ac.tugSpeed = this.simple.throttle * 5; ac.tugSteer = this.simple.tugSteer; this.rig.tug.angle = ac.tugSteer * 35 * Math.PI / 180; this.tug.rotation.z = this.rig.tug.angle; }
    }
    const showLaunch = !this.menu.open && !ac.crashed && !!ac.def.glider && (!!ac.cable || (ac.onGround && Math.hypot(ac.vel.x, ac.vel.y) < 1.5));
    this.launchBtn.style.display = showLaunch ? 'block' : 'none';
    if (showLaunch) this.launchBtn.textContent = ac.cable ? 'RELEASE CABLE' : 'START WINCH LAUNCH';
    this.cableLine.visible = !!ac.cable;
    if (ac.cable && ac.def.hook) {
      const pa = this.cableLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = nedToThree(ac.worldPoint(ac.def.hook)), b = nedToThree(ac.cable.anchor);
      pa.setXYZ(0, a.x, a.y, a.z); pa.setXYZ(1, b.x, b.y, b.z); pa.needsUpdate = true;
    }
    this.vario.update(!!ac.def.glider && !this.menu.open && !sim.paused && !ac.crashed, -ac.vel.z, dt);
    const showPush = !this.menu.open && !ac.crashed && ac.def.retractableGear && ac.onGround && (this.pushing || Math.hypot(ac.vel.x, ac.vel.y) < 0.5);
    this.pushBtn.style.display = showPush ? 'block' : 'none';
    if (showPush) this.pushBtn.textContent = this.pushing ? 'FINISHED - BACK TO AIRCRAFT' : 'START PUSHBACK';
    const showPark = !this.menu.open && !ac.crashed && ac.onGround && !this.pushing && !ac.def.glider;
    this.parkBtn.style.display = showPark ? 'block' : 'none';
    if (showPark) { this.parkBtn.textContent = this.simple.parking ? 'PARK BRAKE ON' : 'PARK BRAKE OFF'; this.parkBtn.classList.toggle('on', this.simple.parking); }
    if (showBridge) this.bridgeBtn.textContent = this.jetBridges.connected ? 'RETRACT JET BRIDGE' : 'CONNECT JET BRIDGE';

    // aircraft transform (model authored in the body frame, origin at the datum)
    const R = bodyMatrix(ac.q);
    R.setPosition(nedToThree(ac.worldPoint(new Vec3(0, 0, 0))));
    this.aircraftGroup.matrix.copy(R);
    this.aircraftGroup.matrixWorldNeedsUpdate = true;

    this.rig.update(ac, dt);
    const cam = this.rig.camera;
    const inCockpit = this.rig.mode === 'cockpit' && !this.rig.tug.on;
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
    if (!this.menu.open) this.minimap?.update(ac);
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
