// JetVault Flight Simulator - browser entry point.

import * as THREE from 'three';
import { loadWorld, World, LandCover } from './world/world';
import { Simulation, SpawnKind } from './sim/simulation';
import { C172 } from './sim/aircraft/c172';
import { B738 } from './sim/aircraft/b738';
import { A320, A340, A350, C17 } from './sim/aircraft/airliners';
import { AirlinerModel, AirlinerCockpit } from './render/airlinerModel';
import { GLIDER } from './sim/aircraft/glider';
import { DARTER } from './sim/aircraft/darter';
import { DRONE } from './sim/aircraft/drone';
import { droneSpeed } from './sim/fdm/aircraft';
import { GliderModel } from './render/gliderModel';
import { DarterModel } from './render/darterModel';
import { GliderCockpit } from './render/cockpitGlider';
import { DroneCockpit } from './render/cockpitDrone';
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
import { Vec3, Quat, clamp, KT } from './core/math';
import { effectivePixelRatio, AutoScale } from './pixelBudget';
import { RoadMarkings } from './render/roadMarkings';
import { Traffic } from './render/traffic';
import { Cabin, cabinSpec, seatChoices, eyeOf, Seat } from './render/cabin';
import { TerminalWalk } from './render/terminalWalk';
import { Ambience } from './audio/ambience';
import { ReplayRecorder, Replay, sampleReplay, parseReplay, weatherAt } from './replay';
import type { FlightControls } from './sim/controls';
import { AutoTrim } from './sim/assists';
import { advanceClock } from './sim/weather';
import { SimpleControls, IS_TOUCH } from './input/simpleControls';
import { Minimap } from './ui/minimap';
import { LoadedPatch } from './world/world';
import { JetBridges } from './render/jetBridges';
import { CrashFx } from './render/crashFx';
import { Buggy, launchPoints, nearestLaunchPoint, LaunchPoint, BUGGY_MAX_SPEED } from './sim/buggy';
import { TreeField, FieldScenery, BuggyModel } from './render/gliderField';
import { GroundVehicles } from './render/groundVehicles';
import { Grade } from './render/grade';
import { Forest } from './render/forest';
import { GrassBlades } from './render/grassBlades';
import { WorldEditor } from './studio/worldEditor';
import { loadCityPack } from './render/cityPack';
import { FOCUS_MODE, airportVisible, FOCUS_AIRCRAFT, PRO } from './config';
import { aircraftAvailable, FlightRewards, wallet } from './economy';
import { KeyframeFlight } from './sim/keyframes';
import { DirectorInput, DirectorShot } from './director';
import { SHOTS } from './shotList';
import { Multiplayer, PlayerState, WeatherShare } from './net/multiplayer';
import { webglAvailable, showFatal } from './fatal';
import { ComfortMeter, finalStars, passengerComment, paxCount, PAX_MULT } from './passengers';
import { hostRoom, joinRoom, validCode, RoomTransport } from './net/transport';
import { RemotePlayers } from './render/remotePlayers';
import { generateCity } from './world/city';
import { LocalProjection, EGPH_ORIGIN } from './world/geo';
import { LC } from './world/world';
import { loadCustomDesign } from './render/cockpitCustom';
import { STUDIO_ORIGIN } from './studio/parts';
import { TyreSmoke } from './render/tyreSmoke';
import { WaterFx } from './render/waterFx';
import { SeaSurface } from './render/seaSurface';
import { sea, seaAmpFromWind, seaHeight, addSurge } from './world/waves';
import { MarshalFigure } from './render/marshalFigure';
import { marshalCall, MarshalSignal } from './sim/marshal';
import { findGateSites } from './world/obstacles';

const loadingMsg = document.getElementById('loading-msg')!;
declare const __BUILD_ID__: string;
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
  private patchRender = new Map<string, { airport: AirportRenderer; buildings: BuildingsRenderer; extras: THREE.Object3D[]; city?: BuildingsRenderer; scenery?: FieldScenery; sites: { east: number; north: number; heading: number }[] }>();
  // glider retrieval: a buggy to tow a landed glider back to a winch launch point
  private buggy = new Buggy();
  private buggyModel = new BuggyModel();
  private retrieving = false;
  private winchFx = 0;
  private rollFx = 0;
  private thump = 0;
  private wasOnGround = false;
  private lastVsDown = 0;
  private forest: Forest | null = null;
  private grassBlades: GrassBlades | null = null;
  private editor: WorldEditor | null = null;
  private editorPrevPaused = false;
  /** Live reflection probe at the aircraft: a cube map of the real surroundings (terrain, buildings, sky), refreshed every few frames. */
  private reflectRT: THREE.WebGLCubeRenderTarget | null = null;
  private reflectCam: THREE.CubeCamera | null = null;
  private reflectFrame = 0;
  private lastDroneSpeed = -1;
  private pendingDetail: (() => void) | null = null;
  private grade: Grade | null = null;
  private tyreSmoke = new TyreSmoke();
  private waterFx = new WaterFx();
  private seaSurface: SeaSurface | null = null;
  private stallEl!: HTMLDivElement;
  // stand marshal
  private marshalFig = new MarshalFigure();
  private marshalStand: { east: number; north: number; heading: number } | null = null;
  private marshalPick = 0;
  private marshalEl!: HTMLDivElement;
  private marshalT = 0;
  private contactShadow!: THREE.Mesh;
  private streamTimer = 0;
  model!: C172Model | B737Model | GliderModel | DarterModel | AirlinerModel;
  cockpit!: Cockpit | B737Cockpit | GliderCockpit | DroneCockpit | AirlinerCockpit;
  aircraftDefs: AircraftDef[] = FOCUS_MODE ? [B738, A320, A340, A350, C17, DRONE] : [C172, B738, A320, A340, A350, C17, GLIDER, DARTER, DRONE];
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
  private lookTmp = new THREE.Vector3();
  /** Director mode: the scripted pilot flies the aircraft; the player flies the camera drone. */
  private director: { shot: DirectorShot; script: KeyframeFlight; t0: number; p0: THREE.Vector3; fwd0: THREE.Vector3; right0: THREE.Vector3; ground: number; state: 'count' | 'run' | 'cut'; until: number; cut: boolean; orbit: boolean } | null = null;
  private directorInput!: DirectorInput;
  private directorStarting = false;
  // ---- the airport walk before a ride along (render/terminalWalk.ts): check-in, security, gate, boarding; then the cabin ----
  private ambience: Ambience | null = null; private walk: TerminalWalk | null = null; private walkPtr: ((e: PointerEvent) => void) | null = null;
  /** Starts the journey: the walk first, then the cabin (the walk has a skip button). */
  mpRide(id: string) {
    if (!this.mp || this.walk) return;
    const pose = this.mp.poses().find((p) => p.id === id);
    if (!pose) { this.hud.toast('That player is not in the air yet (no position received)', 3); return; }
    if (this.riding) this.mpStopRide();
    if (this.rp) this.replayClose(); if (this.director) this.directorStop(false);
    const hash = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7), ap = this.world.airport, others = this.world.airports.filter((a) => a.icao !== ap.icao && airportVisible(a.icao));
    const dest = (others[hash % Math.max(1, others.length)]?.name ?? 'AMSTERDAM').replace(/ (Airport|International).*$/i, '').replace(/^London /, '');
    const pack = ['a320', 'a340', 'a350', 'c17', 'b738'].includes(pose.ac) ? pose.ac : 'a320';
    const def0 = this.aircraftDefs.find((d) => d.id === pose.ac && d.hull) ?? this.aircraftDefs.find((d) => d.id === 'a320')!, hull0 = def0.hull!, cab0 = new Cabin(cabinSpec(def0.id, hull0.x0, hull0.x1, hull0.radius)), choices0 = seatChoices(cab0.spec); cab0.dispose();
    const info = { name: this.mp.name, icao: ap.icao, airportName: ap.name.replace(/ Airport$/, ''), flight: `JV ${1000 + (hash % 9000)}`, to: dest, seat: `${choices0[0]?.seat.row ?? 6}${choices0[0]?.seat.letter ?? 'A'}`, gate: String(10 + (hash % 20)), aircraft: pack, seatOptions: choices0.map((c) => c.label) };
    this.sim.paused = true; this.menu.hide(); this.hud.el.style.display = 'none'; this.aircraftGroup.visible = false; document.body.classList.add('jv-riding');
    this.ambience?.stop(); this.ambience = new Ambience(); this.ambience.init();   // created inside the click that started the journey, so the browser allows sound
    const walk = new TerminalWalk(info, this.ambience); this.walk = walk;
    walk.onDone = (idx) => { this.walkEnd(); const s = choices0[idx]?.seat; setTimeout(() => this.rideEnter(id, s ? { row: s.row, col: s.col } : undefined), 0); };
    this.walkPtr = (e) => { if (e.buttons & 1) walk.look(e.movementX, e.movementY); };
    this.renderer.domElement.addEventListener('pointermove', this.walkPtr);
    this.hud.toast('Airport: follow the glowing markers. Esc leaves the walk.', 4);
    this.mpChanged?.();
  }
  private walkEnd() {
    const w = this.walk; if (!w) return; this.walk = null; w.dispose();
    if (this.walkPtr) { this.renderer.domElement.removeEventListener('pointermove', this.walkPtr); this.walkPtr = null; }
    document.body.classList.remove('jv-riding'); this.aircraftGroup.visible = true; this.hud.el.style.display = '';
  }
  walkCancel() { if (!this.walk) return; this.walkEnd(); this.ambience?.stop(); this.ambience = null; this.sim.paused = true; this.hud.toast('Left the airport walk (paused): press P to resume', 3); this.mpChanged?.(); }

  // ---- ride along (multiplayer): sit in a window seat of another player's aircraft; the local aircraft is replaced by theirs, the flight model stays paused ----
  private riding: { id: string; name: string; p: Vec3; q: Quat; fresh: boolean; yaw: number; pitch: number; cabin: Cabin; seat: Seat; el: HTMLDivElement; info: HTMLSpanElement; infoT: number; lastAlt: number; live: { pos: Vec3; q: Quat; vel: Vec3; omega: Vec3; paused: boolean; view: string; realTime: boolean | undefined } } | null = null;
  private rideNear = 0.5;
  mpRiding() { return this.riding?.id ?? null; }
  /** Mouse look: the camera rig normally, the head in a window seat when riding. */
  private look(dx: number, dy: number) {
    if (this.walk) { this.walk.look(dx, dy); return; }
    const r = this.riding; if (!r) { this.rig.look(dx, dy); return; }
    r.yaw = clamp(r.yaw + dx * 0.004, -1.9, 1.9); r.pitch = clamp(r.pitch - dy * 0.004, -1.0, 1.0);   // yaw to the right is positive, from straight ahead
  }
  private rideEnter(id: string, seatPref?: { row: number; col: number }) {
    if (!this.mp) return;
    const pose = this.mp.poses().find((p) => p.id === id);
    if (!pose) { this.hud.toast('That player is not in the air yet (no position received)', 3); return; }
    if (this.riding) this.mpStopRide();
    if (this.rp) this.replayClose(); if (this.director) this.directorStop(false);
    const sim = this.sim, ac = sim.aircraft;
    const live = { pos: ac.pos.clone(), q: ac.q.clone(), vel: ac.vel.clone(), omega: ac.omega.clone(), paused: sim.paused, view: this.rig.mode, realTime: sim.weather.realTime };
    sim.paused = true; this.menu.hide(); this.hud.el.style.display = 'none';
    this.remotes.hidden.add(id); document.body.classList.add('jv-riding'); this.ambience?.start('cabin'); this.ambience?.chime(false);
    this.rig.setMode('free', ac); this.rig.freeLocked = true;
    // the cabin: built for the pilot's aircraft type (an airliner; anything else gets the A320 cabin) and fitted into the aircraft's body frame
    const def = this.aircraftDefs.find((d) => d.id === pose.ac && d.hull) ?? this.aircraftDefs.find((d) => d.id === 'a320')!, hull = def.hull!;
    const cabin = new Cabin(cabinSpec(def.id, hull.x0, hull.x1, hull.radius)); this.aircraftGroup.add(cabin.group); cabin.addWings();
    this.model.root.visible = false; this.aircraftGroup.visible = true;
    const choices = seatChoices(cabin.spec), first = (seatPref ? choices.find((c) => c.seat.row === seatPref.row && c.seat.col === seatPref.col) : undefined) ?? choices.find((c) => c.seat.window && c.seat.y < 0) ?? choices[0];
    cabin.addPassengers(first.seat.row, first.seat.col, [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 5));
    const el = document.createElement('div'); el.style.cssText = 'position:fixed;inset:0;z-index:12;pointer-events:none;overflow:hidden';
    const bar = document.createElement('div'); bar.style.cssText = 'position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;gap:12px;align-items:center;padding:8px 16px;border-radius:20px;background:rgba(6,12,22,.82);color:#eaf2fb;font:600 13px system-ui,sans-serif;pointer-events:auto;white-space:nowrap';
    const info = document.createElement('span'); bar.appendChild(info);
    const sel = document.createElement('select'); sel.style.cssText = 'background:#111d33;color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:4px 8px';
    choices.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c.label; o.selected = c === first; sel.appendChild(o); });
    sel.onchange = () => { const r = this.riding; if (!r) return; r.seat = choices[Number(sel.value)].seat; r.cabin.addPassengers(r.seat.row, r.seat.col, [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 5)); r.yaw = r.seat.window ? (r.seat.y < 0 ? -0.9 : 0.9) : 0; r.pitch = 0; sel.blur(); };
    bar.appendChild(sel);
    const snd = document.createElement('button'); snd.className = 'jv-btn ghost'; snd.style.cssText = 'padding:5px 12px;min-width:0'; const lab = () => { snd.textContent = this.ambience?.muted ? 'SOUND OFF' : 'SOUND ON'; }; lab(); snd.onclick = () => { this.ambience?.setMuted(!this.ambience.muted); lab(); }; if (this.ambience) bar.appendChild(snd);
    const stop = document.createElement('button'); stop.className = 'jv-btn'; stop.textContent = 'STOP RIDING'; stop.style.cssText = 'padding:5px 12px;min-width:0'; stop.onclick = () => this.mpStopRide(); bar.appendChild(stop);
    el.appendChild(bar); document.body.appendChild(el);
    this.riding = { id, name: this.mp.roster.find((r) => r.id === id)?.name ?? 'player', p: new Vec3(), q: new Quat(), fresh: true, yaw: first.seat.window ? (first.seat.y < 0 ? -0.9 : 0.9) : 0, pitch: 0, cabin, seat: first.seat, el, info, infoT: 0, lastAlt: 0, live };
    this.hud.toast('Riding along: drag with the right mouse button to look around', 4);
    this.mpChanged?.();
  }
  mpStopRide() {
    const r = this.riding; if (!r) return;
    this.riding = null; r.el.remove(); this.ambience?.stop(); this.ambience = null; document.body.classList.remove('jv-riding'); this.aircraftGroup.remove(r.cabin.group); r.cabin.dispose(); this.model.root.visible = true; this.rig.camera.near = this.rideNear; this.rig.camera.updateProjectionMatrix(); this.remotes.hidden.delete(r.id); this.rig.freeLocked = false; this.hud.el.style.display = '';
    const sim = this.sim, ac = sim.aircraft, l = r.live;
    ac.pos = l.pos; ac.q = l.q; ac.vel = l.vel; ac.omega = l.omega; sim.weather.realTime = l.realTime; sim.paused = true;
    this.aircraftGroup.visible = true; this.rig.setMode(l.view as never, ac);
    this.hud.toast('Back in your own aircraft (paused): press P to resume', 4); this.mpChanged?.();
  }
  /** Each frame while riding: follows the other player's smoothed pose (written into the local aircraft so streaming, sky and shadows follow it) and places the head. */
  private rideTick(dt: number) {
    const r = this.riding; if (!r) return;
    const pose = this.mp?.poses().find((p) => p.id === r.id);
    if (!pose) { this.hud.toast(`${r.name} left`, 3); this.mpStopRide(); return; }
    const k = r.fresh ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 14); r.fresh = false;
    r.p = new Vec3(r.p.x + (pose.p[0] - r.p.x) * k, r.p.y + (pose.p[1] - r.p.y) * k, r.p.z + (pose.p[2] - r.p.z) * k);
    const dot = r.q.w * pose.q[0] + r.q.x * pose.q[1] + r.q.y * pose.q[2] + r.q.z * pose.q[3], s = dot < 0 ? -1 : 1;
    const w = r.q.w + (s * pose.q[0] - r.q.w) * k, x = r.q.x + (s * pose.q[1] - r.q.x) * k, y = r.q.y + (s * pose.q[2] - r.q.y) * k, z = r.q.z + (s * pose.q[3] - r.q.z) * k, n = Math.hypot(w, x, y, z) || 1;
    r.q = new Quat(w / n, x / n, y / n, z / n);
    const sim = this.sim, ac = sim.aircraft;
    ac.pos = r.p.clone(); ac.q = r.q.clone(); ac.vel = new Vec3(); ac.omega = new Vec3();
    ac.agl = -ac.pos.z - this.world.terrain.heightAt(ac.pos.y, ac.pos.x);
    r.infoT -= dt;
    if (r.infoT <= 0) { const alt = -ac.pos.z, dtI = 0.5 - r.infoT; r.infoT = 0.5; const v = r.lastAlt ? Math.abs(alt - r.lastAlt) / dtI : 0; void v; r.lastAlt = alt; r.info.textContent = `Riding with ${r.name} \u00b7 ${this.sim.def.id === pose.ac ? '' : pose.ac.toUpperCase() + ' \u00b7 '}${Math.round(alt / 0.3048).toLocaleString()} ft`; }
    r.cabin.update(performance.now() / 1000);
  }
  /** The camera of the window seat (after the rig has run). */
  private rideCamera(cam: THREE.PerspectiveCamera) {
    const r = this.riding; if (!r) return;
    const ac = this.sim.aircraft, R = bodyMatrix(ac.q);
    const f = new THREE.Vector3().setFromMatrixColumn(R, 0), rt = new THREE.Vector3().setFromMatrixColumn(R, 1), dn = new THREE.Vector3().setFromMatrixColumn(R, 2);
    const e = eyeOf(r.cabin.spec, r.seat), datum = nedToThree(ac.worldPoint(new Vec3(0, 0, 0)));
    const pos = datum.clone().addScaledVector(f, e[0]).addScaledVector(rt, e[1]).addScaledVector(dn, e[2]);
    const cp = Math.cos(r.pitch), d = new THREE.Vector3().addScaledVector(f, Math.cos(r.yaw) * cp).addScaledVector(rt, Math.sin(r.yaw) * cp).addScaledVector(dn, -Math.sin(r.pitch));
    cam.position.copy(pos); cam.up.copy(dn).negate(); cam.lookAt(pos.clone().add(d));
    if (cam.fov !== 72 || cam.near > 0.06) { cam.fov = 72; this.rideNear = cam.near > 0.06 ? cam.near : this.rideNear; cam.near = 0.05; cam.updateProjectionMatrix(); }
  }
  // ---- replay (replay.ts): the last minutes are recorded; playback draws the recorded pose with the flight model paused ----
  private roadMarkings!: RoadMarkings; private traffic!: Traffic;
  private recorder = new ReplayRecorder();
  private rp: { replay: Replay; t: number; playing: boolean; speed: number; live: { wx: WeatherSettings; pos: Vec3; q: Quat; vel: Vec3; omega: Vec3; gearExt: number; flap: number; spoiler: number; elevator: number; aileronL: number; aileronR: number; rudder: number; controls: FlightControls; paused: boolean; tod: number; realTime: boolean | undefined; view: string }; bar: HTMLDivElement } | null = null;
  replayActive() { return !!this.rp; }
  private recordTick() {
    const sim = this.sim, ac = sim.aircraft, c = sim.controls;
    if (this.rp || sim.paused || !this.started || this.director || ac.def.drone || ac.crashed) return;
    this.recorder.recordWeather(sim.simTime, sim.weather as never);
    this.recorder.record(sim.simTime, ac, c.throttle, (c.landingLight ? 1 : 0) | (c.beacon ? 2 : 0) | (c.strobes ? 4 : 0) | (c.navLights ? 8 : 0) | (c.taxiLight ? 16 : 0) | (c.reverse ? 32 : 0) | (c.gearDown ? 64 : 0), sim.weather.timeOfDay);
  }
  /** Opens the replay of the recorded flight (or closes it if it is open). */
  replayOpen() {
    if (this.rp) { this.replayClose(); return; }
    if (this.recorder.duration < 3) { this.hud.toast('Nothing to replay yet: fly for a few seconds first', 3); return; }
    const w = this.sim.weather;
    this.replayBegin({ version: 1, aircraft: this.sim.def.id, airport: this.world.airport.icao, dayOfYear: w.dayOfYear, cloud: w.cloudCover, windDirection: w.windDirection, windSpeed: w.windSpeed, qnh: w.qnh, temperatureC: w.temperatureC, frames: this.recorder.frames.slice(), weather: this.recorder.weatherForBuffer() });
  }
  private replayBegin(replay: Replay) {
    const sim = this.sim, ac = sim.aircraft;
    const live = { wx: { ...sim.weather }, pos: ac.pos.clone(), q: ac.q.clone(), vel: ac.vel.clone(), omega: ac.omega.clone(), gearExt: ac.gearExt, flap: ac.flap, spoiler: ac.spoiler, elevator: ac.elevator, aileronL: ac.aileronL, aileronR: ac.aileronR, rudder: ac.rudder, controls: { ...sim.controls }, paused: sim.paused, tod: sim.weather.timeOfDay, realTime: sim.weather.realTime, view: this.rig.mode };
    sim.paused = true; sim.weather.realTime = false; this.menu.hide(); this.hud.el.style.display = 'none';   // the instrument strip shows the live end of the flight, not the replay
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:20;display:flex;gap:10px;align-items:center;padding:10px 16px;border-radius:10px;background:rgba(6,12,22,.86);color:#e8f1f7;font:600 13px system-ui,sans-serif;min-width:min(720px,92vw)';
    document.body.appendChild(bar);
    this.rp = { replay, t: replay.frames[0].t, playing: true, speed: 1, live, bar };
    this.replayBar();
    this.hud.toast('REPLAY: space plays or pauses, V or EXIT returns to the flight', 4);
  }
  private replayBar() {
    const s = this.rp!, bar = s.bar; bar.innerHTML = '';
    const mk = (label: string, fn: () => void) => { const b = document.createElement('button'); b.className = 'jv-btn'; b.style.cssText = 'padding:6px 12px;min-width:0'; b.textContent = label; b.onclick = fn; bar.appendChild(b); return b; };
    const play = mk('\u275a\u275a', () => { s.playing = !s.playing; if (s.playing && s.t >= s.replay.frames[s.replay.frames.length - 1].t - 0.01) s.t = s.replay.frames[0].t; });
    play.dataset.r = 'play';
    mk('\u23ee', () => { s.t = s.replay.frames[0].t; });
    const f0 = s.replay.frames[0].t, f1 = s.replay.frames[s.replay.frames.length - 1].t;
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = String(f0); sl.max = String(f1); sl.step = '0.05'; sl.value = String(s.t); sl.style.cssText = 'flex:1;min-width:120px'; sl.dataset.r = 'slider';
    sl.oninput = () => { s.t = Number(sl.value); }; bar.appendChild(sl);
    const lab = document.createElement('span'); lab.dataset.r = 'time'; lab.style.cssText = 'min-width:84px;text-align:right'; bar.appendChild(lab);
    const sp = document.createElement('select'); for (const v of [0.25, 0.5, 1, 2, 4]) { const o = document.createElement('option'); o.value = String(v); o.textContent = `${v}x`; o.selected = v === 1; sp.appendChild(o); }
    sp.onchange = () => { s.speed = Number(sp.value); }; bar.appendChild(sp);
    const cam = document.createElement('select'); for (const [v, n] of [['chase', 'Chase'], ['cockpit', 'Cockpit'], ['wing', 'Wing'], ['tower', 'Tower'], ['free', 'Free camera']] as const) { const o = document.createElement('option'); o.value = v; o.textContent = n; o.selected = v === this.rig.mode; cam.appendChild(o); }
    cam.onchange = () => { this.rig.setMode(cam.value as never, this.sim.aircraft); }; bar.appendChild(cam);
    mk('SAVE', () => {
      const blob = new Blob([JSON.stringify(s.replay)], { type: 'application/json' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `jetvault-replay-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.style.display = 'none';
    file.onchange = () => { const f = file.files?.[0]; if (f) void f.text().then((t) => this.replayLoad(t)); file.value = ''; }; bar.appendChild(file);
    mk('LOAD', () => file.click());
    mk('EXIT', () => this.replayClose());
  }
  /** Loads a saved replay file (any aircraft and airport: they are switched to the recorded ones). */
  async replayLoad(text: string) {
    const rp = parseReplay(text);
    if (!rp) { this.hud.toast('That is not a valid replay file', 4); return; }
    if (this.rp) this.replayClose(false);
    if (rp.aircraft && this.aircraftDefs.some((d) => d.id === rp.aircraft)) this.selectAircraft(rp.aircraft);
    if (rp.airport && this.world.airports.some((a) => a.icao === rp.airport) && this.world.airport.icao !== rp.airport) { this.world.setAirport(rp.airport); await this.airportChanged(); }
    const w0 = rp.weather?.[0]; if (w0) { const { t: _t, ...rest } = w0; void _t; Object.assign(this.weather, rest); }
    const w = this.weather; w.realTime = false;
    if (!w0) { w.dayOfYear = rp.dayOfYear || w.dayOfYear; w.cloudCover = (rp.cloud || w.cloudCover) as typeof w.cloudCover; w.windDirection = rp.windDirection; w.windSpeed = rp.windSpeed; w.qnh = rp.qnh; w.temperatureC = rp.temperatureC; }   // files from before the weather was recorded
    const f = rp.frames[0];
    await this.fly({ kind: 'air', east: f.p[1], north: f.p[0], altFt: -f.p[2] / 0.3048, hdg: 0 });
    this.replayBegin(rp);
  }
  private replayClose(restore = true) {
    const s = this.rp; if (!s) return;
    this.rp = null; s.bar.remove(); this.hud.el.style.display = '';
    if (!restore) return;
    const sim = this.sim, ac = sim.aircraft, l = s.live;
    ac.pos = l.pos; ac.q = l.q; ac.vel = l.vel; ac.omega = l.omega; ac.gearExt = l.gearExt; ac.flap = l.flap; ac.spoiler = l.spoiler; ac.elevator = l.elevator; ac.aileronL = l.aileronL; ac.aileronR = l.aileronR; ac.rudder = l.rudder;
    Object.assign(sim.controls, l.controls); Object.assign(sim.weather, l.wx); sim.weather.timeOfDay = l.tod; sim.weather.realTime = l.realTime; sim.paused = true;
    this.rig.setMode(l.view as never, ac);
    this.hud.toast('Back in the flight (paused): press P to resume', 4);
  }
  private replayTick(dt: number) {
    const s = this.rp; if (!s || this.menu.open) return;
    const f0 = s.replay.frames[0].t, f1 = s.replay.frames[s.replay.frames.length - 1].t;
    if (s.playing) { s.t += dt * s.speed; if (s.t >= f1) { s.t = f1; s.playing = false; } }
    const f = sampleReplay(s.replay.frames, s.t), sim = this.sim, ac = sim.aircraft, c = sim.controls;
    ac.pos = new Vec3(f.p[0], f.p[1], f.p[2]); ac.q = new Quat(f.q[0], f.q[1], f.q[2], f.q[3]); ac.vel = new Vec3(f.v[0], f.v[1], f.v[2]); ac.omega = new Vec3();
    ac.gearExt = f.gear; ac.flap = f.flap; ac.spoiler = f.spoiler; ac.elevator = f.el; ac.aileronL = f.al; ac.aileronR = f.ar; ac.rudder = f.rud;
    c.throttle = f.thr; c.landingLight = !!(f.bits & 1); c.beacon = !!(f.bits & 2); c.strobes = !!(f.bits & 4); c.navLights = !!(f.bits & 8); c.taxiLight = !!(f.bits & 16); c.reverse = !!(f.bits & 32); c.gearDown = !!(f.bits & 64);
    sim.weather.timeOfDay = f.tod;
    const wx = weatherAt(s.replay.weather, s.t);   // the weather of that moment of the flight (clouds, wind, rain, visibility), not whatever is set now
    if (wx) { const { t: _t, ...rest } = wx; void _t; Object.assign(sim.weather, rest); }
    const sl = s.bar.querySelector('[data-r=slider]') as HTMLInputElement | null; if (sl && document.activeElement !== sl) sl.value = String(s.t);
    const tm = s.bar.querySelector('[data-r=time]'); if (tm) tm.textContent = `${(s.t - f0).toFixed(1)} / ${(f1 - f0).toFixed(1)} s`;
    const pb = s.bar.querySelector('[data-r=play]'); if (pb) pb.textContent = s.playing ? '\u275a\u275a' : '\u25b6';
  }
  // passengers on board (passengers.ts)
  passengers = false; private comfort = new ComfortMeter(); private paxOnBoard = 0; private paxPill: HTMLDivElement | null = null; private paxPillT = 0;
  setPassengers(on: boolean) { this.passengers = on && this.sim.def.profile.standClearance > 12; }
  private paxActive() { return this.passengers && this.sim.def.profile.standClearance > 12 && !this.sim.def.drone; }
  private showFlightResult(r: { coins: number; km: number; label: string; sink: number }) {
    const stars = finalStars(this.comfort, r.sink), mult = PAX_MULT[stars], coins = Math.round(r.coins * mult);
    wallet.add(coins, r.km);
    const fpm = Math.round(Math.abs(r.sink) * 196.85), c = this.comfort.comfort;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(2,6,14,.62);font:15px/1.5 system-ui,sans-serif;color:#eaf2fb';
    const box = document.createElement('div'); box.style.cssText = 'min-width:min(440px,90vw);padding:26px 30px;border-radius:12px;background:#0d1a30;border:1px solid rgba(255,255,255,.18);text-align:center';
    const msg = passengerComment(stars, r.sink, this.comfort);
    box.innerHTML = `<div style="letter-spacing:.14em;font-size:12px;opacity:.7">FLIGHT COMPLETE</div><div style="font-size:42px;color:#ffd24a;margin:6px 0">${'\u2605'.repeat(stars)}<span style="opacity:.25">${'\u2605'.repeat(5 - stars)}</span></div><div>${this.paxOnBoard} passengers \u00b7 comfort ${Math.round(c)} % \u00b7 landing ${fpm} fpm (${r.label})</div><div style="margin:10px 0;opacity:.9"></div><div style="font-size:20px;font-weight:700">+${coins} JetCoins</div><div style="opacity:.7;font-size:13px">${r.km.toFixed(1)} km \u00b7 trip ${r.coins} \u00d7 ${mult} for the passengers</div>`;
    (box.children[3] as HTMLElement).textContent = msg;
    const b = document.createElement('button'); b.className = 'jv-btn'; b.textContent = 'CONTINUE'; b.style.marginTop = '16px'; b.onclick = () => el.remove();
    box.appendChild(b); el.appendChild(box); document.body.appendChild(el);
    this.comfort.reset();
  }
  private updatePaxPill(dt: number) {
    if (!this.paxActive() || this.menu.open || this.director || this.rp) { if (this.paxPill) this.paxPill.style.display = 'none'; return; }
    this.paxPillT -= dt; if (this.paxPillT > 0 && this.paxPill) return; this.paxPillT = 0.5;
    if (!this.paxPill) { const p = document.createElement('div'); p.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:8;padding:5px 14px;border-radius:16px;background:rgba(6,12,22,.7);color:#eaf2fb;font:600 13px system-ui,sans-serif;pointer-events:none'; document.body.appendChild(p); this.paxPill = p; }
    const s = this.comfort.liveStars; this.paxPill.style.display = ''; this.paxPill.textContent = `${this.paxOnBoard} passengers  ${'\u2605'.repeat(s)}${'\u2606'.repeat(5 - s)}`;
  }
  // multiplayer
  mpChanged: (() => void) | null = null;
  private mp: Multiplayer | null = null; private mpCode: string | null = null; private mpLogLines: string[] = [];
  private remotes = new RemotePlayers();
  private mpStart(net: RoomTransport, name: string, host: boolean, code: string | null) {
    this.mpLeave();
    const mp = new Multiplayer(net, name, host); this.mp = mp; this.mpCode = code; this.mpLogLines = [];
    mp.onRoster = () => this.mpChanged?.();
    mp.onChat = (n, t) => { this.mpLogLines.push(`${n}: ${t}`); this.hud?.toast(`${n}: ${t}`, 6); this.mpChanged?.(); };
    mp.getWeather = () => { const w = this.weather; return { dayOfYear: w.dayOfYear, timeOfDay: w.timeOfDay, cloudCover: w.cloudCover, windDirection: w.windDirection, windSpeed: w.windSpeed, qnh: w.qnh, temperatureC: w.temperatureC }; };
    mp.onWeather = (w: WeatherShare) => { this.applyWeather({ ...this.weather, realTime: false, dayOfYear: w.dayOfYear, timeOfDay: w.timeOfDay, cloudCover: w.cloudCover as WeatherSettings['cloudCover'], windDirection: w.windDirection, windSpeed: w.windSpeed, qnh: w.qnh, temperatureC: w.temperatureC }); };
    net.onClosed = () => { this.hud?.toast('The host closed the room', 4); this.mpLeave(); };
    this.mpChanged?.();
  }
  async mpHost(name: string) { const { net, code } = await hostRoom(); this.mpStart(net, name, true, code); return code; }
  async mpJoin(code: string, name: string) {
    if (!validCode(code)) throw new Error('A room code is 5 letters or digits.');
    const net = await joinRoom(code); this.mpStart(net, name, false, code);
  }
  mpLeave() { if (this.walk) this.walkCancel(); if (this.riding) this.mpStopRide(); if (!this.mp) return; this.mp.leave(); this.mp = null; this.mpCode = null; this.remotes.clear(); this.mpChanged?.(); }
  mpSay(text: string) { this.mp?.say(text); }
  mpState() { return this.mp ? { code: this.mpCode, host: this.mp.isHost, roster: this.mp.roster, log: this.mpLogLines, riding: this.riding?.id ?? null } : null; }
  /** This player's aircraft as sent to the others. */
  private mpMine(): PlayerState | null {
    if (!this.started || this.riding || this.walk) return null;   // a passenger sends nothing: the aircraft is the pilot's
    const ac = this.sim.aircraft, c = this.sim.controls, p = ac.worldPoint(new Vec3(0, 0, 0));
    return { name: '', ac: ac.def.id, p: [p.x, p.y, p.z], q: [ac.q.w, ac.q.x, ac.q.y, ac.q.z], v: [ac.vel.x, ac.vel.y, ac.vel.z], gear: ac.gearExt, flap: ac.flap, lights: (c.landingLight ? 1 : 0) | (c.beacon ? 2 : 0) | (c.strobes ? 4 : 0) | (c.navLights ? 8 : 0) };
  }
  private rewards = new FlightRewards();
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
    this.applyPixelRatio();
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
    const startDef = this.aircraftDefs.find((d) => d.id === FOCUS_AIRCRAFT) ?? C172;
    this.sim = new Simulation(this.world, startDef, this.weather);
    this.payload = startDef.stations.map((s) => s.mass);
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
    this.world.roadTest = (e, n) => this.roadMarkings.onRoad(e, n);   // grass and trees keep off the roads
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
    this.scene.add(this.buggyModel.group, this.marshalFig.group, this.tyreSmoke.group, this.waterFx.group);
    const stamp = document.createElement('div');
    stamp.textContent = 'build ' + __BUILD_ID__;
    stamp.style.cssText = 'position:fixed;right:8px;bottom:4px;font:10px system-ui,sans-serif;color:rgba(255,255,255,0.55);text-shadow:0 0 3px #000;z-index:5;pointer-events:none';
    document.body.appendChild(stamp);
    console.info('JetVault build', __BUILD_ID__);
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
    window.addEventListener('keydown', (e) => { if (e.code === 'F3' && !e.repeat) { e.preventDefault(); this.togglePerf(); } });
    if (new URLSearchParams(location.search).has('perf')) this.togglePerf();
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
    this.scene.add(this.remotes.group);
    this.roadMarkings = new RoadMarkings((e, n) => this.world.terrain.heightAt(e, n)); this.scene.add(this.roadMarkings.group);
    this.traffic = new Traffic(this.roadMarkings, (e, n) => this.world.terrain.heightAt(e, n)); this.scene.add(this.traffic.group);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || (e.target as HTMLElement | null)?.tagName === 'SELECT' || this.director) return;
      if (e.code === 'KeyV' && !e.repeat && !this.menu.open) this.replayOpen();
      else if (e.code === 'Space' && this.rp) { this.rp.playing = !this.rp.playing; e.preventDefault(); }
    });
    this.crashFx = new CrashFx(this.scene);
    this.env = new EnvironmentRenderer(this.scene, this.renderer, this.terrain.uniforms.uDetail.value as THREE.DataTexture);
    this.terrain.uniforms.uCloudShadow = { value: this.env.cloudShadowTex };
    this.terrain.uniforms.uCloudShadowRect = { value: this.env.cloudShadowRect };
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    if (!new URLSearchParams(location.search).has('nograde')) this.grade = new Grade(this.renderer, this.scene, this.rig.camera);
    this.rig.eye.set(this.sim.def.eye.x, this.sim.def.eye.y, this.sim.def.eye.z);
    this.placeTower();
    this.directorInput = new DirectorInput(this.renderer.domElement, this.rig, { restart: () => { if (this.director) void this.directorStart(this.director.shot); }, keepVisible: () => [this.menu.el, ...(this.card ? [this.card] : [])] });
    window.addEventListener('keydown', (e) => {
      const d = this.director; if (!d || d.state !== 'cut' || e.repeat) return;
      const i = SHOTS.findIndex((s) => s.id === d.shot.id);
      if (e.code === 'KeyR') void this.directorStart(d.shot); else if (e.code === 'KeyN' && i >= 0 && i < SHOTS.length - 1) void this.directorStart(SHOTS[i + 1]);
    });
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
      else this.look(-e.deltaX, -e.deltaY); // two-finger scroll moves the camera
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
    (window as any).jetvaultShots = SHOTS;
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
    try { roadsJson = JSON.parse(new TextDecoder().decode(await fetchBuf(`${base}/${pm.id}/roads.json`))); roads = buildRoadOverlay(roadsJson!, pm.cx, pm.cy, 2 * pm.imgHalf); this.roadMarkings.addPatch(pm.id, roadsJson!); } catch { /* optional data */ }
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
    let city: BuildingsRenderer | undefined;
    if (airport.icao === 'EGPH') {
      // Edinburgh city to the east, generated on the land-cover built-up cells (illustrative, not the real buildings)
      city = new BuildingsRenderer(generateCity(this.world));
      city.maxDistance = this.graphics.buildingDistanceKm * 1000;
      this.scene.add(city.group);
      if (PRO) loadCityPack(this.world).then((g) => { this.scene.add(g); }).catch((e) => console.warn('city pack not loaded', e));
    }
    this.patchRender.set(pm.id, { airport: ar, buildings: br, extras, city, scenery, sites: gateStands });
    this.jetBridges.addPatch(pm.id, airport.gates ?? [], lp.buildings, (e, n) => this.world.terrain.heightAt(e, n) - 0.2);
    this.minimap?.addPatch(pm.id, { cx: pm.cx, cy: pm.cy, half: pm.imgHalf, imagery: (imagery?.texture.image as CanvasImageSource) ?? null, roads: roadsJson, airport });
    if (this.world.airport === airport) this.placeTower();
  }

  private removePatchRender(id: string) {
    this.terrain.removePatch(id); this.roadMarkings.removePatch(id);
    this.jetBridges.removePatch(id);
    this.minimap?.removePatch(id);
    const r = this.patchRender.get(id);
    if (r) { disposeTree(r.airport.group); r.buildings.dispose(); r.city?.dispose(); for (const x of r.extras) { this.scene.remove(x); disposeTree(x); } this.patchRender.delete(id); }
  }

  /** Loads patches the aircraft is approaching and releases the ones it has left (hysteresis: 12 km in, 30 km out). */
  private streamPatches() {
    const ac = this.sim.aircraft, e = ac.pos.y, n = ac.pos.x;
    for (const pm of this.world.meta.patches) {
      if (!airportVisible(pm.icao)) continue;
      const d = this.world.patchDistance(pm, e, n);
      const loaded = this.world.loaded.has(pm.id);
      if (!loaded && d < 12000) { this.world.loadPatch(pm.id).catch((err) => console.warn('patch load failed', pm.id, err)); }
      else if (loaded && d > 30000 && !(this.world.airport.icao === pm.icao && (this.menu.open || !this.started))) this.world.unloadPatch(pm.id);
    }
  }

  /** Makes sure every patch near a position is in memory (used before spawning there). */
  private async ensurePatchesNear(e: number, n: number) {
    await Promise.all(this.world.meta.patches.filter((pm) => airportVisible(pm.icao) && this.world.patchDistance(pm, e, n) < 12000).map((pm) => this.world.loadPatch(pm.id)));
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
    const bigJet = !!this.sim.def.turbofans && !jet;   // the A320 / A340 / A350 (converted models, no cockpit model)
    this.model = bigJet ? new AirlinerModel(this.sim.def.id) :  this.sim.def.id === 'darter' || this.sim.def.id === 'drone' ? new DarterModel(this.sim.def.id === 'drone') : glider ? new GliderModel() : jet ? new B737Model() : new C172Model();
    if (this.model instanceof GliderModel && !new URLSearchParams(location.search).has('oldglider')) this.model.loadGlb('./models/glider_underpoly.bin').catch((e) => console.warn('glider model not loaded, using the procedural one', e));
    if (this.model instanceof AirlinerModel) this.model.load().catch((e) => console.warn('airliner model not loaded', e));
    if (this.model instanceof B737Model) {
      const m = this.model;
      const q = new URLSearchParams(location.search);
      (q.has('oldmodel') ? m.loadReal('./models/b738.fbx') : q.has('geomodel') ? m.loadGlb('./models/b738_geo.bin') : m.loadFull('./models/b738_full.bin?v=' + encodeURIComponent(__BUILD_ID__.split(' ')[0])))
        .catch((e) => { console.warn('full 737 model not loaded, trying the previous one', e); return m.loadGlb('./models/b738_geo.bin'); })
        .catch((e) => console.warn('737 model not loaded, using the procedural one', e));
    }
    if (this.sim.def.id === 'drone') (this.model as DarterModel).root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined; if (m && m.color && m.color.getHex() === 0xe9edf2) m.color.set(0xffc81e); }); // safety yellow
    this.cockpit = bigJet ? new AirlinerCockpit(this.sim.def.id) : this.sim.def.id === 'drone' ? new DroneCockpit(this.sim) : glider ? new GliderCockpit(this.sim) : jet ? new B737Cockpit(this.sim, this.world.airport) : new Cockpit(this.sim);
    // the detailed flight deck (86 MB, 1.75 M triangles) is only fetched the first time the cockpit view is used
    this.pendingDetail = jet && this.graphics.renderScale > 0.5 ? () => (this.cockpit as B737Cockpit).useDetailed('./models/cockpit737').catch((e) => console.warn('detailed 737 cockpit not loaded, using the simple one', e)) : null;
    this.aircraftGroup.add(this.model.root, this.cockpit.root);
    if (this.rig) {
      this.rig.eye.set(this.sim.def.eye.x, this.sim.def.eye.y, this.sim.def.eye.z);
      // 737 clean-view camera: higher/forward seating keeps the PFD and windshield unobstructed.
      // No changes to aircraft physics or world coordinates.
      if (jet) this.rig.eye.set(14.0, -0.53, -0.78); // the seat of the full flight-deck model (cockpitFull.ts)
      if (jet) { const my = loadCustomDesign(); if (my?.eye) this.rig.eye.set(STUDIO_ORIGIN.x + my.eye[0], my.eye[2], STUDIO_ORIGIN.z - my.eye[1]); } // eye placed in the Cockpit Studio // was 14.47,-0.93: that put the eye through the window frame of the real deck model
      this.rig.chaseDist = jet ? 60 : bigJet ? 22 + 1.6 * this.sim.def.wingSpan : glider ? 24 : 16;
      this.rig.headPitch = jet ? -0.17 : bigJet ? -0.03 : -0.2;
      if (jet) { this.rig.fovCockpit = 76; this.rig.camera.fov = this.rig.mode === 'cockpit' ? 76 : this.rig.camera.fov; this.rig.camera.updateProjectionMatrix(); }
      if (jet) this.rig.wingCam.set(-6, -21, -2.5); else if (glider) this.rig.wingCam.set(-0.5, -9.5, -1.0); else this.rig.wingCam.set(-1.2, -6.6, -1.6);
    }
    if (this.debug) { this.scene.remove(this.debug.group); this.debug = new DebugView(this.sim.aircraft, this.world); this.scene.add(this.debug.group); }
  }

  /** Switch aircraft type (rebuilds the simulation and the aircraft visuals). */
  selectAircraft(id: string) {
    if (!aircraftAvailable(id)) { this.hud?.toast(`Unlock it with JetCoins (${wallet.price(id) || '-'}) in Aircraft Selection`, 3); return; }
    if (this.sim.def.id === id) return;
    const def = this.aircraftDefs.find((d) => d.id === id)!;
    this.sim = new Simulation(this.world, def, this.weather);
    this.sim.paused = true; // the new aircraft is not placed until a start position is chosen
    this.payload = def.stations.map((st) => st.mass);
{
      // jets start with a sensible load: payload as set, fuel for about 85 % of the maximum takeoff mass (the 737 keeps its 45 %)
      const d = this.sim.def; let f = 1;
      if (id === 'b738') f = 0.45;
      else if (d.turbofans) { const fuelKg = d.tanks.reduce((a, t) => a + t.capacity, 0) * 0.8, pay = d.stations.reduce((a, t) => a + t.mass, 0); f = Math.max(0.2, Math.min(1, (0.85 * d.maxTakeoffMass - d.emptyMass - pay) / fuelKg)); }
      this.fuelFraction = [f, f];
    }
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
      if (pts.size === 1) this.look(dx, dy);
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
    el.addEventListener('pointermove', (e) => { if (rmb && e.pointerType === 'mouse') this.look(e.movementX, e.movementY); });
    el.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 2) rmb = false; });
  }

  // ---------------------------------------------------------------- MenuHost
  get assists() { return this.simple.assists; }
  setAssists(on: boolean) { this.simple.setAssists(on); if (!on) this.simple.setArcade(false); this.hud.toast(on ? 'Beginner assists on' : 'Realistic mode: no automatic trim, rudder or heading hold'); }
  get arcade() { return this.simple.arcade; }
  setArcade(on: boolean) { this.simple.setArcade(on); this.hud.toast(on ? 'Easy flying on' : 'Easy flying off'); }
  startView: 'cockpit' | 'chase' = 'chase';

  async fly(spawn: SpawnKind | { kind: 'air'; east: number; north: number; altFt: number; hdg: number }) {
    this.recorder.clear();
    if (this.director && !this.directorStarting) this.directorStop(false);
    // make sure the detail around the start position is in memory before the aircraft is placed there
    if (spawn.kind === 'air') await this.ensurePatchesNear(spawn.east, spawn.north);
    else { const c = airportCentre(this.world.airport); await this.ensurePatchesNear(c.x, c.y); }
    const ac = this.sim.aircraft;
    ac.payload = [...this.payload];
    this.comfort.reset(); this.paxOnBoard = 0;
    if (this.paxActive()) { ac.payload = ac.def.stations.map((st) => st.max * 0.8); this.paxOnBoard = paxCount(ac.payload.reduce((a, b) => a + b, 0)); this.hud.toast(`${this.paxOnBoard} passengers on board: fly smoothly for a better rating`, 4); }
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
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.renderer.domElement.focus();
  }
  /** Starts a film shot: loads it, shows 3-2-1, runs the scripted aircraft and camera for the shot length, then says CUT. */
  async directorStart(shot0: DirectorShot, userOrbit = this.director?.orbit ?? false) {
    const shot: DirectorShot = userOrbit && !shot0.rail ? { ...shot0, cam: undefined, view: undefined } : shot0;
    this.directorStop(false); this.directorStarting = true;
    this.menu.hide(); this.showCard('LOADING', shot.title);
    const w = this.weather; w.realTime = false; w.dayOfYear = shot.dayOfYear; w.timeOfDay = shot.timeOfDay; w.cloudCover = shot.cloud;
    if (this.world.airport.icao !== 'EGPH') { this.world.setAirport('EGPH'); await this.airportChanged(); }   // the shots are written for Edinburgh
    this.selectAircraft(shot.aircraft);
    if (this.sim.def.id !== shot.aircraft) { this.directorStarting = false; this.hideCard(); this.menu.show(); return; }   // locked aircraft
    this.sim.setWeather(w);
    const def = this.sim.def;
    if (shot.kind === 'landing' && def.turbofans) {   // a landing weight of about 72 % of the maximum takeoff mass
      const fuelKg = def.tanks.reduce((a, t) => a + t.capacity, 0) * 0.8, pay = def.stations.reduce((a, t) => a + t.mass, 0);
      const f = Math.max(0.15, Math.min(1, (0.72 * def.maxTakeoffMass - def.emptyMass - pay) / fuelKg)); this.fuelFraction = [f, f];
    }
    const ap = this.world.airport, rw = ap.runways.flatMap((r) => r.ends).find((e) => e.ident === shot.runway) ?? ap.runways[0].ends[0];
    const spawn = shot.spawn ?? (shot.kind === 'takeoff' ? { kind: 'runway' as const, ident: rw.ident } : { kind: 'approach' as const, ident: rw.ident, distanceNm: shot.nm ?? 4 });
    await this.fly(spawn);
    this.menu.hide();
    const sim = this.sim, ac = sim.aircraft;
    const script = new KeyframeFlight(sim, shot.kind, rw.ident, shot.spawn ? { heading: shot.spawn.hdg, east: shot.spawn.east, north: shot.spawn.north, altMsl: shot.spawn.altFt * 0.3048 } : {});
    sim.preStep = () => script.step();
    const p0 = nedToThree(ac.pos), psi = ac.euler[2];
    const fwd0 = new THREE.Vector3(Math.sin(psi), 0, -Math.cos(psi)), right0 = new THREE.Vector3(Math.cos(psi), 0, Math.sin(psi));
    this.director = { shot, script, t0: -1, p0, fwd0, right0, ground: rw.elev, state: 'count', until: performance.now() + 3300, cut: false, orbit: userOrbit };
    this.rig.setMode(shot.view ?? (userOrbit && !shot.rail ? 'chase' : 'free'), ac);
    this.rig.freeLocked = true; this.setCursor(false);
    this.railS = shot.rail?.s0 ?? 0; this.railRw = { x: rw.x, y: rw.y, hdg: rw.hdgTrue * Math.PI / 180 }; this.railLast = performance.now();
    this.directorInput.setClean(false); this.directorInput.setClean(true);
    this.sim.paused = true; this.directorStarting = false;
    this.directorCam(0);
  }
  /** The scripted camera for the current time of the shot. */
  /** Shows or hides the mouse pointer (hidden while a shot is being filmed, shown on the CUT card). */
  private setCursor(show: boolean) { document.body.style.cursor = show ? '' : 'none'; this.renderer.domElement.style.cursor = show ? '' : 'none'; }
  private railS = 0; private railRw = { x: 0, y: 0, hdg: 0 }; private railLast = 0;
  private directorCam(t: number) {
    const d = this.director; if (!d) return;
    if (d.shot.rail) {   // runway camera on a rail: only forward / backward along the runway; it always looks at the aircraft
      const now = performance.now(), dt = Math.min(0.1, (now - this.railLast) / 1000); this.railLast = now;
      const k = this.rig.freeKeys, sp = (k.has('ShiftLeft') ? 120 : 30) * dt;
      if (k.has('KeyW') || k.has('ArrowUp')) this.railS += sp; if (k.has('KeyS') || k.has('ArrowDown')) this.railS -= sp;
      this.railS = THREE.MathUtils.clamp(this.railS, -400, 2600);
      const r = d.shot.rail, h = this.railRw.hdg, ux = Math.sin(h), uy = Math.cos(h);
      const e = this.railRw.x + ux * this.railS + uy * r.side, n = this.railRw.y + uy * this.railS - ux * r.side;
      const pos = new THREE.Vector3(e, this.world.heightAt(e, n) + r.height, -n), look = nedToThree(this.sim.aircraft.pos), dir = look.clone().sub(pos).normalize();
      this.rig.freePos.copy(pos); this.rig.freeYaw = Math.atan2(-dir.x, -dir.z); this.rig.freePitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      if (t === 0) { this.rig.camera.fov = r.fov; this.rig.camera.updateProjectionMatrix(); }
      return;
    }
    if (!d.shot.cam) return;
    const ac = this.sim.aircraft, psi = ac.euler[2], p = nedToThree(ac.pos);
    const c = d.shot.cam(t, { p, psi, fwd: new THREE.Vector3(Math.sin(psi), 0, -Math.cos(psi)), right: new THREE.Vector3(Math.cos(psi), 0, Math.sin(psi)), p0: d.p0, fwd0: d.fwd0, right0: d.right0, ground: d.ground });
    const rig = this.rig, dir = c.look.clone().sub(c.pos).normalize();
    rig.freePos.copy(c.pos); rig.freeYaw = Math.atan2(-dir.x, -dir.z); rig.freePitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    if (rig.camera.fov !== c.fov) { rig.camera.fov = c.fov; rig.camera.updateProjectionMatrix(); }
  }
  /** Called every frame: the 3-2-1 countdown, the shot clock and the CUT card. */
  private directorTick() {
    const d = this.director; if (!d || this.directorStarting) return;
    if (d.state === 'count') {
      const left = d.until - performance.now();
      if (left > 0) { this.showCard(String(Math.ceil(left / 1100)), d.shot.title); return; }
      d.state = 'run'; d.t0 = this.sim.simTime; this.sim.paused = false; this.showCard('ACTION', '', 700);
    } else if (d.state === 'run') {
      const t = this.sim.simTime - d.t0;
      this.directorCam(t);
      if (t >= d.shot.duration) { d.state = 'cut'; this.sim.paused = true; this.showCut(); }
    }
  }
  private card: HTMLDivElement | null = null;
  private showCard(big: string, small: string, hideAfter = 0) {
    if (!this.card) {
      const c = document.createElement('div'); this.card = c;
      c.style.cssText = 'position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none;color:#fff;font-family:system-ui,sans-serif;text-shadow:0 2px 18px rgba(0,0,0,.7)';
      document.body.appendChild(c);
    }
    this.card.innerHTML = `<div style="font:800 ${big.length > 2 ? 64 : 150}px system-ui">${big}</div><div style="font:600 20px system-ui;opacity:.85">${small}</div>`;
    if (hideAfter) setTimeout(() => { if (this.director?.state === 'run') this.hideCard(); }, hideAfter);
  }
  private hideCard() { this.card?.remove(); this.card = null; }
  private showCut() {
    this.showCard('CUT', ''); this.setCursor(true);
    const c = this.card!, shots = SHOTS, d = this.director!, i = shots.findIndex((s) => s.id === d.shot.id);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:12px;margin-top:18px;pointer-events:auto';
    const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.className = 'jv-btn'; b.textContent = label; b.onclick = fn; row.appendChild(b); };
    btn('START AGAIN  (R)', () => void this.directorStart(d.shot));
    if (i >= 0 && i < shots.length - 1) btn('NEXT SHOT  (N)', () => void this.directorStart(shots[i + 1]));
    btn('MENU  (Esc)', () => { this.directorStop(true); this.menu.show(); this.menu.go('director'); });
    c.appendChild(row);
  }
  directorStop(showUi = true) {
    this.hideCard(); this.rig.freeLocked = false; this.setCursor(true);
    if (!this.director) return;
    this.sim.preStep = null; this.director = null; this.sim.paused = false;
    this.directorInput.setClean(false);
    if (showUi) this.rig.setMode(this.startView, this.sim.aircraft);
  }
  resume() { this.sim.paused = false; this.menu.hide(); (document.activeElement as HTMLElement | null)?.blur?.(); this.renderer.domElement.focus(); }
  canResume() { return this.started && !this.sim.aircraft.crashed; }
  applyWeather(w: WeatherSettings) { this.weather = w; this.sim.setWeather(w); this.hud?.toast('Weather applied'); }
  /** Sharpness: the quality scale times the automatic scale, held to a pixel budget (a 4.5K iMac would otherwise draw about 6 million pixels). */
  private autoScale = new AutoScale(); private menuFrame = 0;
  private applyPixelRatio() {
    this.renderer.setPixelRatio(effectivePixelRatio(window.innerWidth, window.innerHeight, window.devicePixelRatio, this.graphics.renderScale * this.autoScale.scale));
    this.grade?.setSize(window.innerWidth, window.innerHeight);
  }
  applyGraphics(g: GraphicsSettings) {
    this.graphics = g;
    this.applyPixelRatio(); this.traffic?.setDensity(g.renderScale < 0.8 ? 0.35 : 1);
    if (this.grade) { this.grade.setSize(window.innerWidth, window.innerHeight); this.grade.setQuality(g.fx ?? (g.terrainDetail > 1.2 ? 'full' : g.renderScale < 0.8 ? 'min' : 'mid')); }
    this.renderer.shadowMap.enabled = g.shadows;
    this.env.sun.castShadow = g.shadows;
    this.env.farShadows = g.farShadows !== false;
    const type = g.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type || this.env.sun.shadow.mapSize.x !== g.shadowSize) {
      this.renderer.shadowMap.type = type;
      this.env.sun.shadow.mapSize.set(g.shadowSize, g.shadowSize);
      this.env.sun.shadow.map?.dispose(); this.env.sun.shadow.map = null; // rebuilt at the new size
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of ([] as THREE.Material[]).concat(m)) x.needsUpdate = true; });
    }
    this.terrain.detail = g.terrainDetail;
    for (const r of this.patchRender.values()) { r.buildings.maxDistance = g.buildingDistanceKm * 1000; if (r.city) r.city.maxDistance = g.buildingDistanceKm * 1000; }
  }

  private resize() {
    this.applyPixelRatio();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.grade?.setSize(window.innerWidth, window.innerHeight);
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
  }

  /** Simplified control events (keys G/F/B/C/Esc or touch buttons). */
  private handleSimple(ev: string) {
    const c = this.sim.controls, ac = this.sim.aircraft;
    if (ev === 'menu' && this.walk) { this.walkCancel(); return; }
    if (ev === 'menu') { if (this.menu.open) { if (this.canResume()) this.resume(); } else { this.sim.paused = true; this.menu.show(); } return; }
    if (this.menu.open) return;
    if (ev === 'gear' && ac.def.retractableGear) { c.gearDown = !c.gearDown; this.hud.toast(c.gearDown ? 'Gear down' : 'Gear up'); }
    if (ev === 'gear' && !ac.def.retractableGear) this.hud.toast('Fixed landing gear');
    if (ev === 'flaps') {
      const det = ac.def.controls.flapDetents, lim = ac.def.profile.flapLimitKt;
      const next = (Math.round(c.flapLever) + 1) % det.length, kt = ac.cas / KT;
      if (lim && next > Math.round(c.flapLever) && kt > lim[next] + 3) {   // extending flaps above the speed limit for that setting is refused, as the real flap load relief would
        this.hud.toast(`Flaps ${Math.round((det[next] * 180) / Math.PI)} refused: ${Math.round(kt)} kt is above the ${lim[next]} kt limit`);
      } else {
        c.flapLever = next;
        this.hud.toast(`Flaps ${Math.round((det[c.flapLever] * 180) / Math.PI)}`);
      }
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
    if (ev === 'bungee') {
      if (!ac.def.glider) this.hud.toast('The bungee launch is for gliders');
      else if (!this.atLaunchPoint()) this.hud.toast('Take the glider to a launch point first (cones at the runway end)');
      else if (this.sim.startBungee()) this.hud.toast('BUNGEE LAUNCH! Hold on: Mach 1 in seconds. Release with R');
      else this.hud.toast('Stop on the ground to start a bungee launch');
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
    const tex = this.reflectRT ? this.reflectRT.texture : this.scene.environment;
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

  /** True when (east, north) is on a runway strip (centreline within half the width plus 25 m): no marshal and no pushback there. */
  private onRunwayStrip(E: number, N: number): boolean {
    for (const rw of this.world.airport.runways) {
      const [a, b] = rw.ends, dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((E - a.x) * dx + (N - a.y) * dy) / L2));
      if (Math.hypot(E - (a.x + t * dx), N - (a.y + t * dy)) < rw.width / 2 + 25) return true;
    }
    return false;
  }

  /** Stand marshal: picks the gate you are heading for, stands in front of it and signals; the HUD line says the same in words. */
  private updateMarshal(dt: number) {
    const ac = this.sim.aircraft, fig = this.marshalFig;
    const active = !this.menu.open && !ac.crashed && !!ac.def.turbofans && ac.onGround && !this.pushing && !this.retrieving;
    const hide = () => { fig.group.visible = false; this.marshalEl.style.display = 'none'; this.marshalStand = null; };
    if (!active) { hide(); return; }
    const datum = ac.worldPoint(new Vec3(0, 0, 0));
    const E = datum.y, N = datum.x, hdg = ac.euler[2];
    if (this.onRunwayStrip(E, N)) { hide(); return; }
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

  /** F3 (or ?perf): the performance readout (FPS, frame time, draw calls, triangles, physics time). */
  private togglePerf() {
    if (this.perfEl) { this.perfEl.remove(); this.perfEl = null; return; }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:10px;bottom:70px;z-index:40;background:#000a;color:#9fe0ff;font:12px/1.35 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:6px;white-space:pre;pointer-events:none';
    document.body.appendChild(el); this.perfEl = el;
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
  private geoProj = new LocalProjection(EGPH_ORIGIN.lat, EGPH_ORIGIN.lon);
  private whereCache = { e: 1e9, n: 1e9, lat: EGPH_ORIGIN.lat, lon: EGPH_ORIGIN.lon };
  /** Latitude/longitude of the aircraft (focus point), refreshed only when it has moved 200 m: the sun and moon are computed for this place. */
  private whereAmI(focus: THREE.Vector3) {
    const e = focus.x, n = -focus.z, c = this.whereCache;
    if (Math.hypot(e - c.e, n - c.n) > 200) { const ll = this.geoProj.inverse(e, n); c.e = e; c.n = n; c.lat = ll.lat; c.lon = ll.lon; }
    return { lat: c.lat, lon: c.lon };
  }
  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    const t0 = performance.now();
    const sim = this.sim, ac = sim.aircraft;
    if (!sim.paused && !this.menu.open && !ac.def.drone && !this.director) {   // JetCoins: paid when a flight ends with a landing
      const r = this.rewards.update(dt, ac.onGround, ac.agl, Math.hypot(ac.vel.x, ac.vel.y), Math.max(0, ac.vel.z), ac.crashed);
      if (this.paxActive()) this.comfort.update(dt * sim.timeScale, ac.loadFactor, (ac.euler[0] * 180) / Math.PI, (ac.euler[1] * 180) / Math.PI, !ac.onGround);
      if (r && this.paxActive()) this.showFlightResult(r);
      else if (r) { wallet.add(r.coins, r.km); this.hud.toast(`+${r.coins} JetCoins  \u00b7  ${r.km.toFixed(1)} km flown, ${r.label}`, 6); }
    }
    this.updatePaxPill(dt);
    this.input.consume(); // legacy bindings are disabled in the simplified control scheme
    this.replayTick(dt);
    this.rideTick(dt);
    this.walk?.update(dt);
    this.menuFrame = (this.menuFrame + 1) % 4;
    const drawWorld = !this.menu.open || (!this.menu.home && this.menuFrame === 0);   // see where the world is drawn below
    for (const ev of this.simple.consume()) { if ((!this.director && !this.rp && !this.riding && !this.walk) || ev === 'menu' || (this.rp && ev === 'camera')) this.handleSimple(ev); }   // in Director mode the keys are the camera's, only Esc (menu) still works
    if (!this.menu.open) {
      if (!this.director && !this.rp && !this.riding && !this.walk) this.simple.update(dt, sim.controls, ac);
      if (sim.def.drone) { const sp = droneSpeed(sim.controls.throttle, sim.def.drone), k = Math.round(sp); if (k !== this.lastDroneSpeed) { this.lastDroneSpeed = k; this.hud.toast(sp ? `Drone speed ${Math.round(sp * 1.944)} kt (${k} m/s)` : 'Drone motor off (keys 2-9 set the speed)'); } }
      if (!sim.paused && this.simple.assists && sim.def.profile.fixedTrim !== undefined && ac.onGround && !sim.def.drone) {
        sim.controls.trim = sim.def.profile.fixedTrim;   // neutral trim on the ground; in the air the auto-trim holds the flight path hands-off
      } else if (!sim.paused && this.simple.assists && !sim.def.drone) sim.controls.pitch = clamp(sim.controls.pitch + this.autoTrim.update(dt * sim.timeScale, ac, sim.controls, this.simple.rawPitch), -1, 1);
      if (!sim.def.drone && !sim.def.glider) sim.controls.trim = Math.min(sim.controls.trim, 0.1);   // keep the nose-up trim low
    }
    this.updateBuggy(dt);
    if (PRO) {
      sea.t = performance.now() / 1000; sea.amp = seaAmpFromWind(sim.weather.windSpeed);
      if (!this.seaSurface) { this.seaSurface = new SeaSurface(this.terrain.uniforms.uDetail.value as THREE.Texture, this.world, this.renderer); this.scene.add(this.seaSurface.group); }
      if (drawWorld) { const cp = this.rig.camera.position; this.seaSurface.update(cp, this.env.night, this.world.landAt(cp.x, -cp.z) === LC.WATER && this.world.terrain.heightAt(cp.x, -cp.z) < 3 && cp.y < seaHeight(cp.x, -cp.z)); }
      while (ac.waterImpacts.length) { const v = ac.waterImpacts.shift()!; const p = nedToThree(ac.pos); p.y = this.world.waterSurface(ac.pos.y, ac.pos.x) ?? seaHeight(ac.pos.y, ac.pos.x); if (v > 6) { this.waterFx.impact(p, v); addSurge(ac.pos.y, ac.pos.x, Math.min(3.0, v / 30)); } }
    }
    if (PRO && !sim.paused) this.waterFx.update(dt * sim.timeScale, ac, (e, n) => this.world.isWater(e, n), (e, n) => this.world.waterSurface(e, n) ?? seaHeight(e, n));
    if (!sim.paused) this.tyreSmoke.update(dt, ac, (e, n) => this.world.terrain.heightAt(e, n));
    this.updateMarshal(dt);
    if (!ac.crashed) nedToThree(ac.vel, this.lastVel);
    sim.advance(dt);
    this.recordTick();
    if (ac.crashed && !this.crashShown) {
      this.crashShown = true;
      this.aircraftGroup.visible = false;
      this.rig.setMode('chase', ac);
      this.crashFx.trigger(nedToThree(ac.pos), this.lastVel.clone(), nedToThree(ac.pos).y - Math.max(ac.agl, 0), ac.def === B738 ? 35.8 : 11, 0xe9edf3);
    }
    this.crashFx.update(dt);
    this.jetBridges.update(dt, ac);
    const showBridge = !this.menu.open && !this.rp && !ac.crashed && !this.pushing && this.jetBridges.canConnect(ac);
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
    const dpt = ac.worldPoint(new Vec3(0, 0, 0)), showPush = !this.menu.open && !this.rp && !ac.crashed && ((ac.def.retractableGear && ac.onGround && (this.pushing || (Math.hypot(ac.vel.x, ac.vel.y) < 0.5 && !this.onRunwayStrip(dpt.y, dpt.x)))) || this.retrieving);
    this.pushBtn.style.display = showPush ? 'block' : 'none';
    if (showPush) this.pushBtn.textContent = this.retrieving ? 'LEAVE THE BUGGY' : this.pushing ? 'FINISHED - BACK TO AIRCRAFT' : 'START PUSHBACK';
    const showPark = !this.menu.open && !this.rp && !ac.crashed && ac.onGround && !this.pushing && !ac.def.glider;
    this.parkBtn.style.display = showPark ? 'block' : 'none';
    if (showPark) { this.parkBtn.textContent = this.simple.parking ? 'PARK BRAKE ON' : 'PARK BRAKE OFF'; this.parkBtn.classList.toggle('on', this.simple.parking); }
    if (showBridge) this.bridgeBtn.textContent = this.jetBridges.connected ? 'RETRACT JET BRIDGE' : 'CONNECT JET BRIDGE';

    // aircraft transform (model authored in the body frame, origin at the datum)
    const R = bodyMatrix(ac.q);
    R.setPosition(nedToThree(ac.worldPoint(new Vec3(0, 0, 0))));
    this.aircraftGroup.matrix.copy(R);
    this.aircraftGroup.matrixWorldNeedsUpdate = true;

    if (!this.reflectRT && !new URLSearchParams(location.search).has('noreflect')) {
      this.reflectRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      this.reflectCam = new THREE.CubeCamera(0.5, 120000, this.reflectRT);
      this.scene.add(this.reflectCam);
    }
    if (this.reflectRT && this.reflectCam && !sim.paused && ++this.reflectFrame % 12 === 0) {
      const p = nedToThree(ac.worldPoint(new Vec3(0, 0, -2)));
      this.reflectCam.position.copy(p);
      const vis = this.aircraftGroup.visible; this.aircraftGroup.visible = false; this.contactShadow.visible = false;
      this.reflectCam.update(this.renderer, this.scene);
      this.aircraftGroup.visible = vis;
    }
    if (!this.forest && !new URLSearchParams(location.search).has('noforest')) { this.forest = new Forest(this.world, new URLSearchParams(location.search).has('forestlite') ? 1300 : 2300, 15); this.scene.add(this.forest.group); }
    if (this.forest && !this.menu.open) this.forest.update(this.rig.camera.position);
    if (PRO && !this.grassBlades) { this.grassBlades = new GrassBlades(this.world); this.scene.add(this.grassBlades.group); }
    if (this.grassBlades && !this.menu.open) { const g = this.rig.camera.position; this.grassBlades.update(g, g.y - this.world.terrain.heightAt(g.x, -g.z), performance.now() / 1000); }
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
    if (PRO && !this.editor && this.world) {
      this.editor = new WorldEditor(this.scene, this.rig.camera, this.renderer.domElement, this.world);
      this.editor.onChange = (on) => { if (on) { this.editorPrevPaused = this.sim.paused; this.sim.paused = true; } else this.sim.paused = this.editorPrevPaused; };
    }
    this.directorTick();
    if (this.editor?.active) this.editor.update(dt); else this.rig.update(ac, dt);
    const cam = this.rig.camera;
    if (this.riding) this.rideCamera(cam);
    {
      // stall: the camera shudders with the airframe buffet and a banner flashes while the aircraft is stalled / about to
      const b = sim.paused ? 0 : ac.buffet;
      const warn = !sim.paused && !ac.onGround && !ac.crashed && b > 0.25; // only when really at the stall, not at the early warning
      this.stallEl.style.display = warn ? 'block' : 'none';
      if (warn) this.stallEl.style.opacity = b > 0.4 || Math.floor(performance.now() / 250) % 2 === 0 ? '1' : '0.35';
    }
    {
      // takeoff roll: the runway rumbles under the wheels and the view widens as the engines spool up and speed builds
      const gs = Math.hypot(ac.vel.x, ac.vel.y);
      const want = !sim.paused && ac.onGround && !ac.def.glider && !this.pushing && sim.controls.throttle > 0.55 ? Math.min(1, gs / 70) : 0;
      this.rollFx += (want - this.rollFx) * (1 - Math.exp(-dt * (want > this.rollFx ? 1.5 : 3)));
      if (this.rollFx > 0.02) {
        const t = performance.now() / 1000, k = 0.0016 * this.rollFx * (0.6 + 0.4 * Math.min(1, gs / 40));
        cam.position.x += (Math.sin(t * 43) + Math.sin(t * 71 + 1)) * k * 0.6; cam.position.y += (Math.sin(t * 57) + Math.sin(t * 89 + 2)) * k; cam.position.z += Math.sin(t * 63 + 3) * k * 0.6;
        cam.rotateZ(Math.sin(t * 37) * 0.0008 * this.rollFx);
        if (this.rig.mode !== 'tower') { cam.fov = (this.rig.mode === 'cockpit' ? this.rig.fovCockpit : this.rig.fovExternal) + 2 * this.rollFx; cam.updateProjectionMatrix(); }
      }
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
    if (!sim.paused && this.rig.mode !== 'tower') {
      const onGround = ac.gearStates.some((g) => g.contact);
      if (onGround && !this.wasOnGround && this.lastVsDown > 0.4) this.thump = Math.min(1, this.lastVsDown / 3);
      this.wasOnGround = onGround; this.lastVsDown = ac.vel.z;
      this.thump *= Math.exp(-dt * 4);
      const t = performance.now() / 1000;
      const turb = onGround ? 0 : sim.weather.turbulence * Math.min(1, ac.cas / 60) * 0.5;
      if (this.thump > 0.01) cam.position.y -= Math.sin(t * 22) * 0.06 * this.thump;
      if (turb > 0.01) { cam.position.x += Math.sin(t * 7.1) * 0.012 * turb; cam.position.y += Math.sin(t * 9.3 + 1) * 0.02 * turb; cam.rotateZ(Math.sin(t * 5.3) * 0.0025 * turb); }
    }
    for (const r of this.patchRender.values()) r.scenery?.update(sim.weather.windDirection, sim.weather.windSpeed, sim.simTime);
    const inCockpit = this.rig.mode === 'cockpit' && !this.rig.tug.on;
    if (inCockpit && this.pendingDetail) { const f = this.pendingDetail; this.pendingDetail = null; f(); }
    this.model.setCockpitView(inCockpit);
    this.cockpit.root.visible = inCockpit;
    const focus = nedToThree(ac.pos);
    if (!sim.paused) advanceClock(sim.weather, dt);
    this.env.update(sim.weather, sim.simTime, cam.position, focus, this.whereAmI(focus), cam.getWorldDirection(this.lookTmp), ac.agl);
    if (PRO) {
      // under the sea surface: blue-green murk, short visibility
      const under = this.world.landAt(cam.position.x, -cam.position.z) === LC.WATER && this.world.terrain.heightAt(cam.position.x, -cam.position.z) < 3 && cam.position.y < seaHeight(cam.position.x, -cam.position.z);
      this.scene.background = under ? (this.scene.fog as THREE.FogExp2).color : null;
      this.env.sky.visible = !under;   // underwater there is no sky behind the murk (it showed as white lines at the horizon)
      if (under) { const f = this.scene.fog as THREE.FogExp2; const dep = Math.max(0, seaHeight(cam.position.x, -cam.position.z) - cam.position.y), k = 1 - Math.exp(-dep / 25); f.color.setRGB(0.02 * (1 - k) + 0.004 * k, 0.16 * (1 - k) + 0.03 * k, 0.24 * (1 - k) + 0.07 * k); f.density = 0.028 + 0.012 * k; }
    }
    for (const m of this.scene.children) if (m.renderOrder >= 2 && m.renderOrder <= 3) m.visible = m.visible && this.graphics.clouds;
    this.model.update(ac, sim.controls, sim.paused ? 0 : dt * sim.timeScale, this.env.night);
    if (this.mp) { this.mp.update(dt, () => this.mpMine()); this.remotes.setTagsVisible(!this.walk && !this.riding); this.remotes.update(this.mp.poses(), cam, dt); }
    if (inCockpit) this.cockpit.update(dt, this.env.night);
    this.terrain.update(cam.position, sim.simTime);
    this.roadMarkings.update(cam.position, ac.agl, this.env.night);
    this.traffic.update(sim.paused || this.menu.open ? 0 : dt, cam.position, ac.agl, this.env.night);
    this.terrain.setNight(this.env.night);
    this.terrain.setWet(sim.weather.rain > 0.1 ? Math.min(1, sim.weather.rain * 1.5) : 0);
    for (const r of this.patchRender.values()) { r.airport.update(cam.position, this.env.lightLevel, window.innerHeight / 1000); r.buildings.update(cam.position, this.env.night); r.city?.update(cam.position, this.env.night); }
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) { this.streamTimer = 0.5; this.streamPatches(); }
    this.debug.update();
    this.hud.update(sim, dt, this.rig.mode);
    if (!this.menu.open) this.minimap?.update(ac);
    if (this.menu.open) this.menu.drawMap();

    // nobody sees the world behind the opaque Home screen, and only dimly behind the other menu pages: do not draw it there (this is most of the GPU work)
    if (!this.menu.open && !sim.paused && !this.director) { const s = this.autoScale.update(dt); if (s !== null) { this.applyPixelRatio(); this.hud.toast(`Resolution ${Math.round(s * 100)} % to keep the frame rate up`, 2); } } else this.autoScale.reset();
    this.renderer.toneMappingExposure = this.env.tune.exposure * (1 + 1.6 * this.env.night); // eye adaptation to the dark
    if (this.walk) this.walk.render(this.renderer);
    else if (!drawWorld) { /* menu: skip */ } else if (this.grade) {
      // sun position on screen (z = 1 when the sun is in front of the camera): drives the glare veil
      const sp = this.env.sunDir.clone().multiplyScalar(50000).add(cam.position).project(cam);
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      const ahead = fwd.dot(this.env.sunDir) > 0 ? this.env.sunShine : 0;
      this.grade.setCamera(cam);
      this.grade.set(this.env.night, 1, new THREE.Vector3(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, ahead));
      this.grade.render();
    } else this.renderer.render(this.scene, cam);
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

if (!webglAvailable()) showFatal(new Error('WebGL 2 is not available'));
else {
  try {
    const app = new App();
    app.init().catch((e) => { console.error(e); showFatal(e); });
  } catch (e) { console.error(e); showFatal(e); }
}
