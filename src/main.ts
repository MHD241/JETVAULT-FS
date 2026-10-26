// JetVault Flight Simulator - browser entry point.

import * as THREE from 'three';
import { loadWorld, World, LandCover } from './world/world';
import { Simulation, SpawnKind } from './sim/simulation';
import { C172 } from './sim/aircraft/c172';
import { B738 } from './sim/aircraft/b738';
import { GLIDER } from './sim/aircraft/glider';
import { GliderModel, GliderCockpit } from './render/gliderModel';
import { Vario } from './ui/vario';
import { currentRegion } from './world/region';
import { airportCentre } from './world/airport';
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
import { LoadedPatch } from './world/world';
import { JetBridges } from './render/jetBridges';
import { CrashFx } from './render/crashFx';
import { Buggy, launchPoints, nearestLaunchPoint, LaunchPoint, BUGGY_MAX_SPEED } from './sim/buggy';
import { TreeField, FieldScenery, BuggyModel } from './render/gliderField';
import { GroundVehicles } from './render/groundVehicles';
import { TyreSmoke } from './render/tyreSmoke';
import { MarshalFigure } from './render/marshalFigure';
import { marshalCall, MarshalSignal } from './sim/marshal';
import { findGateSites } from './world/obstacles';

const loadingMsg = document.getElementById('loading-msg')!;
const loadingBar = document.getElementById('loading-bar')!;
let step = 0;
const progress = (m: string) => { step++; loadingMsg.textContent = m; loadingBar.style.width = `${Math.min(100, step * 11)}%`; };

/** Frees the GPU resources of an object tree (geometries, materials, textures) and detaches it. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of ([] as THREE.Material[]).concat((m.material as THREE.Material | THREE.Material[]) ?? [])) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
  });
  root.removeFromParent();
}

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
  private patchRender = new Map<string, { airport: AirportRenderer; buildings: BuildingsRenderer; extras: THREE.Object3D[]; scenery?: FieldScenery; sites: { east: number; north: number; heading: number }[] }>();
  // glider retrieval: a buggy to tow a landed glider back to a winch launch point
  private buggy = new Buggy();
  private buggyModel = new BuggyModel();
  private retrieving = false;
  private winchFx = 0;
  private tyreSmoke = new TyreSmoke();
  private stallEl!: HTMLDivElement;
  // stand marshal
  private marshalFig = new MarshalFigure();
  private marshalStand: { east: number; north: number; heading: number } | null = null;
  private marshalPick = 0;
  private marshalEl!: HTMLDivElement;
  private marshalT = 0;
  private contactShadow!: THREE.Mesh;
  private streamTimer = 0;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * this.graphics.renderScale);
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
    this.world = await loadWorld(`./data/${currentRegion()}`, fetchBuf, decodeGray, progress);
    this.attribution = this.world.meta.attribution;
    this.sim = new Simulation(this.world, C172, this.weather);
    this.payload = C172.stations.map((s) => s.mass);
    progress('Building terrain');
    const base = `./data/${currentRegion()}`;
    const lcLoBuf = await fetchBuf(`${base}/${this.world.meta.landcoverLo.file}`);
    const lcLo = await decodeGray(lcLoBuf, this.world.meta.landcoverLo.n);
    const lo = new LandCover(lcLo, this.world.meta.landcoverLo.n, this.world.meta.landcoverLo.half, this.world.meta.landcoverLo.step);
    this.terrain = new TerrainRenderer(this.world.terrain.lo, lo);
    this.scene.add(this.terrain.group);
    this.minimap = new Minimap(this.world.landcover);
    this.jetBridges = new JetBridges();
    this.scene.add(this.jetBridges.group);
    // detail patches (terrain, imagery, roads, airfield, buildings) are streamed in near the aircraft and out behind it
    this.world.onPatchLoaded = (lp) => this.addPatchRender(lp);
    this.world.onPatchUnloaded = (id) => this.removePatchRender(id);
    progress('Building airport and city');
    for (const lp of this.world.loaded.values()) await this.addPatchRender(lp);
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
    this.scene.add(this.buggyModel.group, this.marshalFig.group, this.tyreSmoke.group);
    this.stallEl = document.createElement('div');
    this.stallEl.textContent = 'STALL';
    this.stallEl.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);padding:6px 22px;border-radius:8px;background:rgba(200,30,30,0.85);color:#fff;font:800 28px system-ui,sans-serif;letter-spacing:0.12em;display:none;z-index:6;pointer-events:none';
    document.body.appendChild(this.stallEl);
    {
      // soft contact shadow under the aircraft (ambient occlusion on the ground), on top of the sun shadow
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const g = cv.getContext('2d')!, gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv);
      this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false }));
      this.contactShadow.renderOrder = 1; this.contactShadow.frustumCulled = false;
      this.scene.add(this.contactShadow);
    }
    this.marshalEl = document.createElement('div');
    this.marshalEl.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);padding:8px 16px;border-radius:10px;background:rgba(20,24,32,0.78);color:#ffb000;font:600 15px system-ui,sans-serif;letter-spacing:0.02em;display:none;z-index:6;pointer-events:none;max-width:90vw;text-align:center';
    document.body.appendChild(this.marshalEl);
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
    if (IS_TOUCH) {
      // phones / tablets: lighter rendering
      this.graphics = { ...this.graphics, renderScale: Math.min(this.graphics.renderScale, 0.75), shadows: false, buildingDistanceKm: 5, terrainDetail: 0.7 };
      document.body.classList.add('touch');
    }
    this.hud = new Hud();
    this.applyGraphics(this.graphics);
    this.renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) { this.rig.zoomBy(Math.exp(e.deltaY * 0.012)); return; } // trackpad pinch (browsers report it as ctrl + wheel)
      // a mouse wheel notches in whole steps (or lines); a trackpad two-finger scroll is fine-grained
      const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40 && (wd === undefined || Math.abs(wd) % 120 === 0));
      if (notch) this.rig.zoom(e.deltaY < 0 ? 1 : -1);
      else this.rig.look(-e.deltaX, -e.deltaY); // two-finger scroll moves the camera
    }, { passive: false });
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
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

  // ------------------------------------------------------------------ patch streaming
  /** Creates the renderers of a freshly loaded patch (terrain chunks, airfield, buildings, bridges, minimap). */
  private async addPatchRender(lp: LoadedPatch) {
    const pm = lp.meta;
    const base = `./data/${currentRegion()}`;
    const idx = this.world.meta.patches.findIndex((p) => p.id === pm.id);
    const airport = this.world.airports[idx];
    let roads = null;
    let roadsJson: [string, [number, number][]][] | null = null;
    try { roadsJson = JSON.parse(new TextDecoder().decode(await fetchBuf(`${base}/${pm.id}/roads.json`))); roads = buildRoadOverlay(roadsJson!, pm.cx, pm.cy, 2 * pm.imgHalf); } catch { /* optional data */ }
    let imagery = null;
    try {
      const t = await new THREE.TextureLoader().loadAsync(`${base}/${pm.id}/imagery.jpg`);
      t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; // image row 0 = north = v 1 (flipY default)
      imagery = { texture: t, e0: pm.cx - pm.imgHalf, n0: pm.cy - pm.imgHalf, size: 2 * pm.imgHalf };
    } catch { /* optional data */ }
    if (!this.world.loaded.has(pm.id)) { imagery?.texture.dispose(); return; } // unloaded again while the files were downloading
    this.terrain.addPatch(pm.id, { grid: lp.grid, lc: lp.lc, overlay: buildPavementOverlay(airport), roads, imagery }, idx);
    const ar = new AirportRenderer(airport, this.world.terrain);
    this.scene.add(ar.group);
    const br = new BuildingsRenderer(lp.buildings);
    br.maxDistance = this.graphics.buildingDistanceKm * 1000;
    this.scene.add(br.group);
    const extras: THREE.Object3D[] = [];
    let gateStands: { east: number; north: number; heading: number }[] = [];
    let scenery: FieldScenery | undefined;
    {
      // trees from the land-cover map around every airport (kept off runways and building footprints)
      const segs = airport.runways.map((rw): [number, number, number, number] => [rw.ends[0].x, rw.ends[0].y, rw.ends[1].x, rw.ends[1].y]);
      const trees = new TreeField(this.world, ((c) => ({ e: c.x, n: c.y }))(airportCentre(airport)), airport.icao === 'EGPM' ? 2400 : 3200, lp.buildings, segs, airport.icao === 'EGPM' ? 16 : 20);
      extras.push(trees.group);
      this.scene.add(trees.group);
      gateStands = findGateSites(airport.gates ?? [], lp.buildings).map((s) => ({ east: s.stand[0], north: s.stand[1], heading: (s.stand[2] * Math.PI) / 180 }));
      const sites = gateStands;
      ar.addLeadIns(gateStands);
      if (sites.length) {
        const veh = new GroundVehicles(sites, (e, n) => this.world.terrain.heightAt(e, n));
        extras.push(veh.group);
        this.scene.add(veh.group);
      }
      if (airport.icao === 'EGPM') {
        // gliding site: launch markers, windsock and parked gliders
        scenery = new FieldScenery(airport, this.world, launchPoints(airport));
        extras.push(scenery.group);
        this.scene.add(scenery.group);
      }
    }
    this.patchRender.set(pm.id, { airport: ar, buildings: br, extras, scenery, sites: gateStands });
    this.jetBridges.addPatch(pm.id, airport.gates ?? [], lp.buildings, (e, n) => this.world.terrain.heightAt(e, n) - 0.2);
    this.minimap?.addPatch(pm.id, { cx: pm.cx, cy: pm.cy, half: pm.imgHalf, imagery: (imagery?.texture.image as CanvasImageSource) ?? null, roads: roadsJson, airport });
    if (this.world.airport === airport) this.placeTower();
  }

  private removePatchRender(id: string) {
    this.terrain.removePatch(id);
    this.jetBridges.removePatch(id);
    this.minimap?.removePatch(id);
    const r = this.patchRender.get(id);
    if (r) { disposeTree(r.airport.group); r.buildings.dispose(); for (const x of r.extras) { this.scene.remove(x); disposeTree(x); } this.patchRender.delete(id); }
  }

  /** Loads patches the aircraft is approaching and releases the ones it has left (hysteresis: 12 km in, 30 km out). */
  private streamPatches() {
    const ac = this.sim.aircraft, e = ac.pos.y, n = ac.pos.x;
    for (const pm of this.world.meta.patches) {
      const d = this.world.patchDistance(pm, e, n);
      const loaded = this.world.loaded.has(pm.id);
      if (!loaded && d < 12000) { this.world.loadPatch(pm.id).catch((err) => console.warn('patch load failed', pm.id, err)); }
      else if (loaded && d > 30000 && !(this.world.airport.icao === pm.icao && (this.menu.open || !this.started))) this.world.unloadPatch(pm.id);
    }
  }

  /** Makes sure every patch near a position is in memory (used before spawning there). */
  private async ensurePatchesNear(e: number, n: number) {
    await Promise.all(this.world.meta.patches.filter((pm) => this.world.patchDistance(pm, e, n) < 12000).map((pm) => this.world.loadPatch(pm.id)));
  }

  /** The control tower is the tallest structure near the airport: use the tallest building within 2.5 km. */
  private placeTower() {
    if (!this.rig) return;
    const ob = this.world.obstacles;
    const c = airportCentre(this.world.airport);
    let best = -1, bestH = 0;
    for (const id of ob.query(c.x - 2500, c.y - 2500, c.x + 2500, c.y + 2500)) {
      const b = ob.buildings[id];
      if (b.top - b.base > bestH) { bestH = b.top - b.base; best = id; }
    }
    if (best >= 0) {
      const b = ob.buildings[best];
      this.rig.towerPos.set((b.minE + b.maxE) / 2, b.top + 3, -(b.minN + b.maxN) / 2);
    }
  }

  /** The user picked another airport in the menu. */
  async airportChanged() {
    const pm = this.world.patchOf(this.world.airport.icao);
    if (pm) await this.world.loadPatch(pm.id);
    this.placeTower();
  }

  private buildAircraftVisuals() {
    if (this.model) this.aircraftGroup.remove(this.model.root);
    if (this.cockpit) this.aircraftGroup.remove(this.cockpit.root);
    const jet = this.sim.def.id === 'b738';
    const glider = !!this.sim.def.glider;
    this.model = glider ? new GliderModel() : jet ? new B737Model() : new C172Model();
    if (this.model instanceof B737Model) {
      const m = this.model;
      (new URLSearchParams(location.search).has('oldmodel') ? m.loadReal('./models/b738.fbx') : m.loadGlb('./models/b738_geo.glb')).catch((e) => console.warn('737 model not loaded, using the procedural one', e));
    }
    this.cockpit = glider ? new GliderCockpit() : jet ? new B737Cockpit(this.sim, this.world.airport) : new Cockpit(this.sim);
    if (jet && this.graphics.renderScale > 0.72) (this.cockpit as B737Cockpit).useDetailed('./models/cockpit737').catch((e) => console.warn('detailed 737 cockpit not loaded, using the simple one', e));
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
    // desktop: hold the right mouse button and move to look around
    let rmb = false;
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 2) { rmb = true; el.setPointerCapture(e.pointerId); e.preventDefault(); } });
    el.addEventListener('pointermove', (e) => { if (rmb && e.pointerType === 'mouse') this.rig.look(e.movementX, e.movementY); });
    el.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 2) rmb = false; });
  }

  // ---------------------------------------------------------------- MenuHost
  get assists() { return this.simple.assists; }
  setAssists(on: boolean) { this.simple.setAssists(on); if (!on) this.simple.setArcade(false); this.hud.toast(on ? 'Beginner assists on' : 'Realistic mode: no automatic trim, rudder or heading hold'); }
  get arcade() { return this.simple.arcade; }
  setArcade(on: boolean) { this.simple.setArcade(on); this.hud.toast(on ? 'Easy flying on' : 'Easy flying off'); }
  startView: 'cockpit' | 'chase' = 'chase';

  async fly(spawn: SpawnKind | { kind: 'air'; east: number; north: number; altFt: number; hdg: number }) {
    // make sure the detail around the start position is in memory before the aircraft is placed there
    if (spawn.kind === 'air') await this.ensurePatchesNear(spawn.east, spawn.north);
    else { const c = airportCentre(this.world.airport); await this.ensurePatchesNear(c.x, c.y); }
    const ac = this.sim.aircraft;
    ac.payload = [...this.payload];
    ac.fuel = ac.def.tanks.map((t, i) => t.capacity * this.fuelFraction[i]);
    ac.updateMass();
    if (spawn.kind === 'air') this.sim.spawnAir(spawn.east, spawn.north, spawn.altFt, spawn.hdg);
    else this.sim.spawn(spawn);
    this.crashFx.clear();
    this.sim.aircraft.tugSpeed = null;
    if (this.retrieving) this.exitRetrieval(false);
    this.buggyModel.group.visible = false;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * g.renderScale);
    this.renderer.shadowMap.enabled = g.shadows;
    this.env.sun.castShadow = g.shadows;
    const type = g.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type || this.env.sun.shadow.mapSize.x !== g.shadowSize) {
      this.renderer.shadowMap.type = type;
      this.env.sun.shadow.mapSize.set(g.shadowSize, g.shadowSize);
      this.env.sun.shadow.map?.dispose(); this.env.sun.shadow.map = null; // rebuilt at the new size
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of ([] as THREE.Material[]).concat(m)) x.needsUpdate = true; });
    }
    this.terrain.detail = g.terrainDetail;
    for (const r of this.patchRender.values()) r.buildings.maxDistance = g.buildingDistanceKm * 1000;
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
    if (ev === 'push' && !this.retrieving) {
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
      else if (this.retrieving) this.buggyAction();
      else if (ac.cable) { this.sim.releaseCable(); this.hud.toast('Cable released'); }
      else if (!ac.onGround || Math.hypot(ac.vel.x, ac.vel.y) > 1.5) this.hud.toast('Stop on the ground to start a winch launch');
      else if (!this.atLaunchPoint()) this.startRetrieval();
      else if (this.sim.startWinch()) this.hud.toast('WINCH LAUNCH: it accelerates hard to about 60 kt. Let the glider climb steeply, then lower the nose and release the cable at the top (R or the button)');
    }
    if (ev === 'push' && this.retrieving) this.exitRetrieval(false);
    if (ev === 'park') { this.simple.parking = !this.simple.parking; this.hud.toast(this.simple.parking ? 'Parking brake ON' : 'Parking brake OFF'); }
    if (ev === 'camera') this.rig.setMode(this.rig.mode === 'cockpit' ? 'chase' : 'cockpit', ac);
  }

  // ---------------------------------------------------------------- glider retrieval
  private launchPts(): LaunchPoint[] { return launchPoints(this.world.airport); }
  private atLaunchPoint() {
    const ac = this.sim.aircraft;
    const lp = nearestLaunchPoint(this.launchPts(), ac.pos.y, ac.pos.x, 60);
    if (!lp) return false;
    let d = ac.euler[2] - lp.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d) < 0.45;
  }
  private hookDistance() {
    const ac = this.sim.aircraft, h = this.buggy.hitch();
    const hk = ac.worldPoint(ac.def.hook!);
    return Math.hypot(hk.y - h.east, hk.x - h.north);
  }
  private startRetrieval() {
    const ac = this.sim.aircraft, h = ac.euler[2];
    const fx = Math.sin(h), fy = Math.cos(h);
    // the buggy waits ahead and to the left of the glider, pointing across its nose
    this.buggy.place(ac.pos.y + fx * 9 - fy * 12, ac.pos.x + fy * 9 + fx * 12, h + Math.PI / 2);
    this.retrieving = true;
    this.prevView = this.rig.mode === 'cockpit' ? 'cockpit' : 'chase';
    this.simple.tugMode = true; this.simple.tugSteer = 0; this.simple.tugHold = true; this.simple.parking = false; this.simple.setThrottle(0);
    this.buggyModel.group.visible = true;
    this.rig.setMode('chase', ac); this.rig.chaseDist = 13; this.rig.orbitEl = 0.28; this.rig.orbitAz = 0;
    this.hud.toast('RETRIEVAL BUGGY: drive to the glider nose and hook up (1-9 speed, steer with mouse/arrows, Space brakes), then tow it to the launch point (orange cones)');
  }
  private buggyAction() {
    const ac = this.sim.aircraft, b = this.buggy;
    if (!b.towing) {
      if (this.hookDistance() > 10) { this.hud.toast('Drive the buggy so its tow hitch is at the glider nose'); return; }
      b.towing = true;
      const h = b.hitch();
      ac.cable = { anchor: new Vec3(h.north, h.east, -(this.world.heightAt(h.east, h.north) + 0.7)), vTarget: 0, tMax: 2500, t: 0, tow: true };
      this.simple.tugHold = false;
      this.hud.toast('Rope hooked on. Tow the glider to the launch point (the orange cones at the runway end)');
      return;
    }
    const lp = nearestLaunchPoint(this.launchPts(), b.east, b.north, 70);
    if (!lp) { this.hud.toast('Tow the glider to the launch point first (orange cones at the end of the runway)'); return; }
    // unhook, set the glider on the launch point, park the buggy beside it and get in
    this.sim.placeAtLaunchPoint(lp.east, lp.north, lp.heading);
    b.towing = false; b.speed = 0;
    b.east = lp.east + Math.cos(lp.heading) * 16 - Math.sin(lp.heading) * 4; b.north = lp.north - Math.sin(lp.heading) * 16 - Math.cos(lp.heading) * 4;
    b.heading = lp.heading;
    this.exitRetrieval(true);
    this.hud.toast('Ready on the launch point. Press START WINCH LAUNCH when you are strapped in and ready');
  }
  private exitRetrieval(placed: boolean) {
    const ac = this.sim.aircraft;
    if (!placed && ac.cable?.tow) ac.cable = null;
    this.retrieving = false; this.buggy.towing = false;
    this.simple.tugMode = false; this.simple.tugHold = false; this.simple.parking = false;
    this.rig.focus = null;
    if (!placed) this.buggyModel.group.visible = false;
    this.rig.chaseDist = 24;
    this.rig.setMode(this.prevView, ac);
    this.sim.controls.brakeLeft = 0; this.sim.controls.brakeRight = 0;
  }
  private updateBuggy(dt: number) {
    const b = this.buggy, c = this.sim.controls, ac = this.sim.aircraft;
    if (this.retrieving) {
      const brake = c.brakeLeft > 0.5;
      c.brakeLeft = 0; c.brakeRight = 0;
      if (!this.menu.open && !this.sim.paused) b.step(dt, this.simple.throttle * BUGGY_MAX_SPEED, this.simple.tugSteer, brake);
      if (ac.cable?.tow) {
        const h = b.hitch();
        ac.cable.anchor = new Vec3(h.north, h.east, -(this.world.heightAt(h.east, h.north) + 0.7));
        ac.cable.vTarget = b.speed;
        ac.cable.tMax = 3000;
      }
      if (!ac.onGround) this.exitRetrieval(false);
    }
    if (this.buggyModel.group.visible) {
      const sx = Math.sin(b.heading), cy = Math.cos(b.heading), t = this.world.terrain;
      this.buggyModel.setPose(b.east, b.north, b.heading, t.heightAt(b.east, b.north), t.heightAt(b.east + sx * 1.3, b.north + cy * 1.3), t.heightAt(b.east - sx * 1.3, b.north - cy * 1.3));
      this.buggyModel.beacon.visible = Math.floor(performance.now() / 350) % 2 === 0;
      if (this.retrieving) { this.rig.focus = { pos: this.buggyModel.group.position.clone(), heading: b.heading }; }
    }
  }

  /** Aircraft materials reflect the sky: scene.environment only lights them diffusely, so give each its own envMap (and keep it current as the sun moves). */
  private aircraftEnvTex: THREE.Texture | null = null;
  private envSyncT = 0;
  private syncAircraftEnv() {
    const tex = this.scene.environment;
    if (!tex) return;
    const changed = tex !== this.aircraftEnvTex;
    this.envSyncT -= 1;
    if (!changed && this.envSyncT > 0) return;
    this.envSyncT = 60; // also catches parts that finished loading later
    this.aircraftEnvTex = tex;
    this.aircraftGroup.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of ([] as THREE.Material[]).concat(m)) {
        const s = x as THREE.MeshStandardMaterial;
        if (!s.isMeshStandardMaterial || (s.envMap === tex && !changed)) continue;
        const first = s.envMap === null;
        s.envMap = tex;
        s.envMapIntensity = (s.userData.envI as number | undefined) ?? (s.metalness > 0.5 ? 2.0 : 1.4);
        if (first) s.needsUpdate = true;
      }
    });
  }

  /** Stand marshal: picks the gate you are heading for, stands in front of it and signals; the HUD line says the same in words. */
  private updateMarshal(dt: number) {
    const ac = this.sim.aircraft, fig = this.marshalFig;
    const active = !this.menu.open && !ac.crashed && !!ac.def.turbofans && ac.onGround && !this.pushing && !this.retrieving;
    const hide = () => { fig.group.visible = false; this.marshalEl.style.display = 'none'; this.marshalStand = null; };
    if (!active) { hide(); return; }
    const datum = ac.worldPoint(new Vec3(0, 0, 0));
    const E = datum.y, N = datum.x, hdg = ac.euler[2];
    const gs = Math.hypot(ac.vel.x, ac.vel.y);
    this.marshalPick -= dt;
    if (this.marshalPick <= 0) {
      this.marshalPick = 1;
      let best: { east: number; north: number; heading: number } | null = null, bd = 450;
      for (const r of this.patchRender.values()) for (const s of r.sites) {
        const d = Math.hypot(s.east - E, s.north - N);
        if (d > bd) continue;
        const brg = Math.atan2(s.east - E, s.north - N);
        const ahead = Math.abs(Math.atan2(Math.sin(brg - hdg), Math.cos(brg - hdg)));
        const behind = (E - s.east) * Math.sin(s.heading) + (N - s.north) * Math.cos(s.heading) < 6; // aircraft on the approach side of the stand
        if ((ahead < 1.2 && behind) || d < 14) { best = s; bd = d; }
      }
      // keep the current stand unless it is out of range or a clearly closer one appears
      const cur = this.marshalStand;
      if (!cur || Math.hypot(cur.east - E, cur.north - N) > 480 || (best && best !== cur && Math.hypot(cur.east - E, cur.north - N) > bd + 80 && gs > 1)) this.marshalStand = best;
    }
    const st = this.marshalStand;
    if (!st) { hide(); return; }
    const dist = Math.hypot(st.east - E, st.north - N);
    if (this.jetBridges.connected && dist < 40) { hide(); return; }
    // the marshal stands ahead of the nose, a little to the pilot's right, facing the aircraft
    const fx = Math.sin(st.heading), fy = Math.cos(st.heading);
    const me = st.east + fx * 24 + fy * 3, mn = st.north + fy * 24 - fx * 3;
    fig.place(me, mn, this.world.terrain.heightAt(me, mn), st.heading);
    fig.group.visible = dist < 450;
    const call = marshalCall(st, { east: E, north: N, heading: hdg, speed: gs, parkingBrake: this.simple.parking || this.sim.controls.parkingBrake, enginesRunning: ac.engines.some((e) => e.running) });
    this.marshalT += dt;
    const sig: MarshalSignal = dist > 70 ? 'idle' : call.signal;
    fig.pose(sig, this.marshalT);
    this.marshalEl.style.display = 'block';
    this.marshalEl.textContent = dist > 70 ? `MARSHAL: stand ahead, ${Math.round(dist)} m` : call.text;
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
      if (!sim.paused && this.simple.assists) sim.controls.pitch = clamp(sim.controls.pitch + this.autoTrim.update(dt * sim.timeScale, ac, sim.controls, this.simple.rawPitch), -1, 1);
    }
    this.updateBuggy(dt);
    if (!sim.paused) this.tyreSmoke.update(dt, ac, (e, n) => this.world.terrain.heightAt(e, n));
    this.updateMarshal(dt);
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
    const stopped = ac.onGround && Math.hypot(ac.vel.x, ac.vel.y) < 1.5;
    const showLaunch = !this.menu.open && !ac.crashed && !!ac.def.glider && (this.retrieving || !!ac.cable || stopped);
    this.launchBtn.style.display = showLaunch ? 'block' : 'none';
    if (showLaunch) {
      let txt: string;
      if (this.retrieving) {
        const lp = nearestLaunchPoint(this.launchPts(), this.buggy.east, this.buggy.north, 70);
        if (!this.buggy.towing) { const d = this.hookDistance(); txt = d <= 10 ? 'HOOK UP THE GLIDER' : `DRIVE TO THE GLIDER NOSE (${Math.round(d)} m)`; }
        else txt = lp ? 'UNHOOK AND GET IN' : 'TOW TO THE LAUNCH POINT (CONES)';
      } else if (ac.cable) txt = 'RELEASE CABLE';
      else txt = this.atLaunchPoint() ? 'START WINCH LAUNCH' : 'GET THE BUGGY (RETRIEVE)';
      this.launchBtn.textContent = txt;
    }
    this.cableLine.visible = !!ac.cable;
    if (ac.cable && ac.def.hook) {
      const pa = this.cableLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = nedToThree(ac.worldPoint(ac.def.hook)), b = nedToThree(ac.cable.anchor);
      pa.setXYZ(0, a.x, a.y, a.z); pa.setXYZ(1, b.x, b.y, b.z); pa.needsUpdate = true;
    }
    this.vario.update(!!ac.def.glider && !this.menu.open && !sim.paused && !ac.crashed, -ac.vel.z, dt);
    const showPush = !this.menu.open && !ac.crashed && ((ac.def.retractableGear && ac.onGround && (this.pushing || Math.hypot(ac.vel.x, ac.vel.y) < 0.5)) || this.retrieving);
    this.pushBtn.style.display = showPush ? 'block' : 'none';
    if (showPush) this.pushBtn.textContent = this.retrieving ? 'LEAVE THE BUGGY' : this.pushing ? 'FINISHED - BACK TO AIRCRAFT' : 'START PUSHBACK';
    const showPark = !this.menu.open && !ac.crashed && ac.onGround && !this.pushing && !ac.def.glider;
    this.parkBtn.style.display = showPark ? 'block' : 'none';
    if (showPark) { this.parkBtn.textContent = this.simple.parking ? 'PARK BRAKE ON' : 'PARK BRAKE OFF'; this.parkBtn.classList.toggle('on', this.simple.parking); }
    if (showBridge) this.bridgeBtn.textContent = this.jetBridges.connected ? 'RETRACT JET BRIDGE' : 'CONNECT JET BRIDGE';

    // aircraft transform (model authored in the body frame, origin at the datum)
    const R = bodyMatrix(ac.q);
    R.setPosition(nedToThree(ac.worldPoint(new Vec3(0, 0, 0))));
    this.aircraftGroup.matrix.copy(R);
    this.aircraftGroup.matrixWorldNeedsUpdate = true;

    this.syncAircraftEnv();
    {
      // contact shadow: follows the aircraft over the ground, fades with height; size by aircraft type
      const size = ac.def.turbofans ? [26, 40] : ac.def.glider ? [18, 8] : [10, 9]; // [across, along] (m)
      const hgt = Math.max(0, ac.agl);
      const k = Math.max(0, 1 - hgt / 25) * (this.aircraftGroup.visible ? 1 : 0);
      const c = nedToThree(ac.worldPoint(new Vec3(0, 0, 0)));
      this.contactShadow.position.set(c.x, this.world.terrain.heightAt(c.x, -c.z) + 0.12, c.z);
      this.contactShadow.rotation.y = -ac.euler[2] + Math.PI / 2; // plane's long axis (x after rotateX) follows the nose
      this.contactShadow.scale.set(size[1] * (1 + hgt / 40), 1, size[0] * (1 + hgt / 40));
      (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * k * (this.env.sunElevation > 5 ? 1 : 0.6);
      this.contactShadow.visible = k > 0.02 && !ac.crashed;
    }
    this.rig.update(ac, dt);
    const cam = this.rig.camera;
    {
      // stall: the camera shudders with the airframe buffet and a banner flashes while the aircraft is stalled / about to
      const b = sim.paused ? 0 : ac.buffet;
      if (b > 0.03) {
        const k = 0.05 * b * b + 0.004 * b, t = performance.now() / 1000;
        cam.position.x += (Math.sin(t * 61) + Math.sin(t * 97)) * k; cam.position.y += (Math.sin(t * 73) + Math.sin(t * 113 + 1)) * k; cam.position.z += Math.sin(t * 83 + 2) * k;
        cam.rotateZ(Math.sin(t * 47) * 0.012 * b);
      }
      const warn = !sim.paused && !ac.onGround && !ac.crashed && b > 0.25; // only when really at the stall, not at the early warning
      this.stallEl.style.display = warn ? 'block' : 'none';
      if (warn) this.stallEl.style.opacity = b > 0.4 || Math.floor(performance.now() / 250) % 2 === 0 ? '1' : '0.35';
    }
    // winch launch: widen the view and shake the camera while the cable is dragging the glider up
    const winching = !!ac.cable && !ac.cable.tow && ac.cableTension > 200 && !sim.paused;
    this.winchFx += ((winching ? Math.min(1, ac.cas / 18) : 0) - this.winchFx) * (1 - Math.exp(-dt * (winching ? 4 : 1.5)));
    if (this.winchFx > 0.01 && this.rig.mode !== 'tower') {
      const fx = this.winchFx, base = this.rig.mode === 'cockpit' ? this.rig.fovCockpit : this.rig.fovExternal;
      cam.fov = base + 16 * fx;
      cam.updateProjectionMatrix();
      const k = 0.035 * fx;
      cam.position.x += (Math.random() - 0.5) * k; cam.position.y += (Math.random() - 0.5) * k; cam.position.z += (Math.random() - 0.5) * k;
    } else if (this.rig.mode !== 'tower' && Math.abs(cam.fov - (this.rig.mode === 'cockpit' ? this.rig.fovCockpit : this.rig.fovExternal)) > 0.01) {
      cam.fov = this.rig.mode === 'cockpit' ? this.rig.fovCockpit : this.rig.fovExternal; cam.updateProjectionMatrix();
    }
    for (const r of this.patchRender.values()) r.scenery?.update(sim.weather.windDirection, sim.weather.windSpeed, sim.simTime);
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
    for (const r of this.patchRender.values()) { r.airport.update(cam.position, this.env.lightLevel, window.innerHeight / 1000); r.buildings.update(cam.position, this.env.night); }
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) { this.streamTimer = 0.5; this.streamPatches(); }
    this.debug.update();
    this.hud.update(sim, dt, this.rig.mode);
    if (!this.menu.open) this.minimap?.update(ac);
    if (this.menu.open) this.menu.drawMap();

    this.renderer.toneMappingExposure = this.env.tune.exposure * (1 + 1.6 * this.env.night); // eye adaptation to the dark
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
