// The airport walk for a passenger: a stylised terminal you walk through in first person (WASD, drag to look): check-in hall, security, a gate lounge with a
// window onto the aircraft, and the jet bridge. Each of the first three has one thing to do (press E at the glowing marker); finishing the walk boards the aircraft.
// It is a generic terminal built from simple shapes (not a copy of the real terminal at each airport) in its own small scene; the game world waits, paused.
import * as THREE from 'three';
import { AirlinerModel } from './airlinerModel';
import { B737Model } from './b737Model';
import { PeopleField, Person, rng } from './people';
import { Ambience } from '../audio/ambience';
import { bodyMatrix } from './coords';
import { Quat } from '../core/math';

export interface WalkInfo { name: string; icao: string; airportName: string; flight: string; to: string; seat: string; gate: string; aircraft: string; /** The seats to choose from at check-in (labels like "Row 6A (window, left)"). */ seatOptions?: string[] }
export interface Rect { x0: number; x1: number; z0: number; z1: number }
const R = 0.3;   // body radius

/** True if a circle at (x, z) fits inside one of the rectangles. */
export function walkable(rects: Rect[], x: number, z: number): boolean { return rects.some((r) => x > r.x0 + R && x < r.x1 - R && z > r.z0 + R && z < r.z1 - R); }
/** Moves from (x, z) by (dx, dz), sliding along walls: each axis is tried on its own. */
export function slide(rects: Rect[], x: number, z: number, dx: number, dz: number): [number, number] {
  let nx = x, nz = z; if (walkable(rects, x + dx, z)) nx = x + dx; if (walkable(rects, nx, z + dz)) nz = z + dz; return [nx, nz];
}
/** The four zones of the walk, in order. */
export const ZONES: Rect[] = [{ x0: 0, x1: 26, z0: -9, z1: 9 }, { x0: 26, x1: 44, z0: -5, z1: 5 }, { x0: 44, x1: 72, z0: -12, z1: 12 }, { x0: 72, x1: 94, z0: -1.4, z1: 1.4 }];
export const STEPS = [{ name: 'Check in', x: 14, z: -6.3, text: 'Press E at the check-in desk' }, { name: 'Security', x: 38.5, z: 0, text: 'Press E at the scanner' }, { name: 'Gate', x: 66, z: 0, text: 'Press E at the gate desk to show your boarding pass' }];

function sign(text: string, w: number, h: number, bg: string, fg: string, sub = ''): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `800 ${Math.round(h * (sub ? 0.46 : 0.58))}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
  if (sub) { g.font = `500 ${Math.round(h * 0.24)}px system-ui, sans-serif`; g.fillText(sub, w / 2, h * 0.76); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const mat = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });

export class TerminalWalk {
  readonly scene = new THREE.Scene(); readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  private keys = new Set<string>(); private x = 2; private z = 0; private yaw = 0; private pitch = 0; private t = 0;
  private done = [false, false, false]; private rects: Rect[] = [ZONES[0]];
  private hud = document.createElement('div'); private prompt = document.createElement('div'); private steps = document.createElement('div'); private ticket = document.createElement('div');
  private board!: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture }; private markers: THREE.Mesh[] = []; private ropes: THREE.Object3D[] = [];
  private model: AirlinerModel | null = null; private ended = false; private flash = 0;
  onDone: ((seatIndex: number) => void) | null = null; seatIdx = 0; private people!: PeopleField; private chooser: HTMLDivElement | null = null;
  constructor(private info: WalkInfo, private audio: Ambience | null = null) {
    this.scene.background = new THREE.Color(0x9fb6d0); this.scene.fog = new THREE.Fog(0xcfd8e4, 40, 170);
    this.build();
    this.hud.style.cssText = 'position:fixed;inset:0;z-index:30;pointer-events:none;font:600 14px system-ui,sans-serif;color:#eaf2fb';
    this.steps.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:10px;padding:8px 14px;border-radius:20px;background:rgba(6,12,22,.78)';
    this.prompt.style.cssText = 'position:absolute;left:50%;bottom:120px;transform:translateX(-50%);padding:10px 20px;border-radius:10px;background:rgba(6,12,22,.85);display:none';
    this.ticket.style.cssText = 'position:absolute;left:18px;bottom:18px;padding:12px 16px;border-radius:8px;background:#f4efe3;color:#1c2330;font:600 12px/1.5 system-ui,sans-serif;display:none;box-shadow:0 4px 18px rgba(0,0,0,.4)';
    const help = document.createElement('div'); help.style.cssText = 'position:absolute;right:18px;bottom:18px;padding:8px 14px;border-radius:8px;background:rgba(6,12,22,.7);font-weight:500;pointer-events:none'; help.textContent = 'W A S D walk · Shift run · drag to look · E interact';
    const skip = document.createElement('button'); skip.className = 'jv-btn'; skip.textContent = 'SKIP TO SEAT'; skip.style.cssText = 'position:absolute;top:14px;right:18px;pointer-events:auto;padding:6px 14px;min-width:0'; skip.onclick = () => this.finish();
    this.hud.append(this.steps, this.prompt, this.ticket, help, skip); document.body.appendChild(this.hud);
    window.addEventListener('keydown', this.kd); window.addEventListener('keyup', this.ku);
    this.camera.position.set(this.x, 1.65, this.z); this.refreshSteps();
    this.audio?.start('terminal');
    // sound switch
    const snd = document.createElement('button'); snd.className = 'jv-btn ghost'; snd.style.cssText = 'position:absolute;top:14px;right:170px;pointer-events:auto;padding:6px 12px;min-width:0'; const lab = () => { snd.textContent = this.audio?.muted ? 'SOUND OFF' : 'SOUND ON'; }; lab();
    snd.onclick = () => { this.audio?.setMuted(!this.audio.muted); lab(); }; this.hud.appendChild(snd);
    // touch controls: a joystick on the left, drag on the right half to look, and an E button
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) this.buildTouch();
  }
  private touchMove = { x: 0, y: 0 };
  private buildTouch() {
    const base = document.createElement('div'); base.style.cssText = 'position:absolute;left:28px;bottom:36px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.3);pointer-events:auto;touch-action:none';
    const knob = document.createElement('div'); knob.style.cssText = 'position:absolute;left:35px;top:35px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.4)'; base.appendChild(knob);
    const set = (e: PointerEvent) => { const r = base.getBoundingClientRect(), dx = (e.clientX - r.left - 65) / 65, dy = (e.clientY - r.top - 65) / 65, l = Math.hypot(dx, dy) || 1, k = Math.min(1, l) / l; this.touchMove = { x: dx * k, y: dy * k }; knob.style.transform = `translate(${dx * k * 35}px, ${dy * k * 35}px)`; };
    base.onpointerdown = (e) => { base.setPointerCapture(e.pointerId); set(e); }; base.onpointermove = (e) => { if (e.buttons || e.pressure) set(e); };
    base.onpointerup = base.onpointercancel = () => { this.touchMove = { x: 0, y: 0 }; knob.style.transform = ''; };
    const look = document.createElement('div'); look.style.cssText = 'position:absolute;right:0;top:70px;width:55%;bottom:170px;pointer-events:auto;touch-action:none'; let lx = 0, ly = 0;
    look.onpointerdown = (e) => { look.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; }; look.onpointermove = (e) => { if (!(e.buttons || e.pressure)) return; this.look(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; };
    const eb = document.createElement('button'); eb.className = 'jv-btn'; eb.textContent = 'E'; eb.style.cssText = 'position:absolute;right:28px;bottom:110px;width:70px;height:70px;border-radius:50%;pointer-events:auto;font-size:22px'; eb.onpointerdown = (e) => { e.preventDefault(); this.interact(); };
    this.hud.append(look, base, eb);
  }
  private kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; this.keys.add(e.code); if (e.code === 'KeyE' && !e.repeat) this.interact(); if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); };
  private ku = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  look(dx: number, dy: number) { this.yaw -= dx * 0.004; this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * 0.004)); }

  private build() {
    const sc = this.scene, floorM = mat(0xb9bcc2, { roughness: 0.35 }), wallM = mat(0xe9e7e1), ceilM = mat(0xf2f1ec, { emissive: 0xfff4de, emissiveIntensity: 0.12 }), darkM = mat(0x2a2f38), glassM = mat(0x9fc6e6, { transparent: true, opacity: 0.25, roughness: 0.1 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; sc.add(o); return o; };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);
    sc.add(new THREE.HemisphereLight(0xfff6e8, 0x8a93a3, 1.0));
    // zones: floor, ceiling, walls
    const zoneH = [5.5, 3.3, 5.0, 2.7];
    ZONES.forEach((r, i) => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, h = zoneH[i];
      add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), floorM, cx, 0, cz); add(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), ceilM, cx, h, cz);
      add(new THREE.PlaneGeometry(w, h), wallM, cx, h / 2, r.z1, Math.PI); if (i !== 2) add(new THREE.PlaneGeometry(w, h), wallM, cx, h / 2, r.z0, 0);
      if (i < 3) { const pl = new THREE.PointLight(0xfff0d6, 22, 26, 1.5); pl.position.set(cx, h - 0.6, cz); sc.add(pl); }
    });
    // end walls with a connecting doorway: A|B, B|C (openings in the walls where zones meet), C|D, and the end of the bridge
    const openWall = (x: number, zHalf: number, h: number, big: number) => { const a = (big - zHalf), c = box(0.2, h, a, wallM, x, 0, zHalf + a / 2); void c; box(0.2, h, a, wallM, x, 0, -zHalf - a / 2); box(0.2, h - 2.6, 2 * zHalf, wallM, x, 2.6, 0); };
    box(0.2, 5.5, 18, wallM, 0, 0, 0);                      // behind the start
    openWall(26, 5, 5.5, 9); openWall(44, 5, 5.0, 12); openWall(72, 1.4, 5.0, 12);
    box(0.2, 2.7, 2.8, darkM, 94, 0, 0);                    // the aircraft door at the end of the bridge
    add(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: sign('AIRCRAFT', 256, 256, '#1b2a45', '#ffffff', info(this.info.aircraft)) }), 93.88, 1.6, 0, -Math.PI / 2);
    // ceiling light panels (instanced)
    const lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 0.5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff6e6 }), 90); let li = 0; const m4 = new THREE.Matrix4();
    for (const [zi, rows] of [[0, [-6, -2, 2, 6]], [1, [-2.5, 2.5]], [2, [-9, -4.5, 0, 4.5, 9]], [3, [0]]] as [number, number[]][]) { const r = ZONES[zi]; for (let x = r.x0 + 2; x < r.x1 - 1; x += 4) for (const z of rows) { if (li >= 90) break; m4.makeTranslation(x, zoneH[zi] - 0.02, z); lights.setMatrixAt(li++, m4); } }
    lights.count = li; sc.add(lights);
    // A: check-in desks along both walls, queue posts, big sign, columns
    const deskM = mat(0x3a4a66), topM = mat(0xdfe3e8);
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) { const z = side * 8.2, x = 4 + i * 3.6; box(2.4, 1.0, 1.0, deskM, x, 0, z); box(2.5, 0.06, 1.1, topM, x, 1.0, z); box(0.5, 0.4, 0.06, darkM, x - 0.5, 1.25, z - side * 0.2); add(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: sign(`DESK ${side < 0 ? i + 1 : i + 7}`, 256, 64, '#16233d', '#ffffff') }), x, 3.4, z + (side < 0 ? 0.55 : -0.55), side < 0 ? 0 : Math.PI); }
    add(new THREE.PlaneGeometry(9, 1.8), new THREE.MeshBasicMaterial({ map: sign('CHECK-IN', 512, 100, '#103a6b', '#ffffff', info(this.info.airportName)) }), 13, 4.4, -8.85, 0);
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 8), mat(0xc9ced6, { metalness: 0.6, roughness: 0.3 }), 40); let pi = 0;
    for (const zz of [-4.2, -2.4]) for (let x = 6; x < 20; x += 1.4) { m4.makeTranslation(x, 0.5, zz); post.setMatrixAt(pi++, m4); } post.count = pi; sc.add(post);
    for (let x = 6; x < 24; x += 6) for (const z of [-5, 5]) box(0.5, 5.5, 0.5, mat(0xd4d7dc), x + 0.5, 0, z + (z < 0 ? 1.6 : -1.6));
    // B: security: two belts with trays, the scanner arch, partitions, signs
    for (const z of [-3.2, 3.2]) { box(5.2, 0.8, 0.9, darkM, 32, 0, z); box(5.2, 0.05, 0.8, mat(0x555a63), 32, 0.8, z); for (let k = 0; k < 4; k++) box(0.5, 0.06, 0.38, mat(0x2f9bd0), 30 + k * 1.2, 0.86, z); box(1.2, 1.2, 1.2, mat(0x4a5160), 36, 0, z); }
    const arch = box(0.2, 2.4, 0.2, mat(0xe7e9ee), 38.5, 0, -0.9); void arch; box(0.2, 2.4, 0.2, mat(0xe7e9ee), 38.5, 0, 0.9); box(0.2, 0.2, 2.0, mat(0xe7e9ee), 38.5, 2.4, 0);
    add(new THREE.PlaneGeometry(4, 0.9), new THREE.MeshBasicMaterial({ map: sign('SECURITY', 256, 64, '#c8142c', '#ffffff', 'liquids out, laptops out') }), 28, 2.8, 0, Math.PI / 2);
    // C: gate lounge: seating blocks, shops, a departures board, windows onto the aircraft, the gate desk
    const seatM = mat(0x3a5ca0); for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { box(0.5, 0.45, 0.5, seatM, 49 + c * 3.6, 0, -3 + r * 2.4 - 3); box(0.5, 0.45, 0.12, seatM, 49 + c * 3.6, 0.45, -3 + r * 2.4 - 3.3); }
    ['CAFE', 'BOOKS', 'DUTY FREE', 'TECH', 'FLOWERS'].forEach((n, i) => { const x = 50 + i * 4.6, col = ['#7a4a21', '#255a8a', '#6a2f7a', '#1c5d4a', '#a02b5c'][i]; box(3.4, 3.0, 0.5, mat(0xdedbd3), x, 0, 11.6); add(new THREE.PlaneGeometry(3.2, 0.7), new THREE.MeshBasicMaterial({ map: sign(n, 256, 64, col, '#ffffff') }), x, 3.5, 11.28, Math.PI); box(2.6, 1.8, 0.1, mat(0xa8c4d6, { transparent: true, opacity: 0.6 }), x, 0.4, 11.3); });
    for (let x = 45; x < 71; x += 4) { box(0.15, 5, 0.15, mat(0x4c5360), x, 0, -11.9); }
    add(new THREE.PlaneGeometry(26, 4.4), glassM, 58, 2.5, -11.95, 0);
    const bc = document.createElement('canvas'); bc.width = 512; bc.height = 256; this.board = { cv: bc, tex: new THREE.CanvasTexture(bc) }; this.board.tex.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: this.board.tex }), 48, 3.3, 8, Math.PI / 2 + 0.6); this.drawBoard();
    box(2.8, 1.0, 0.9, deskM, 70.4, 0, 0).rotation.y = 0; add(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshBasicMaterial({ map: sign(`GATE ${this.info.gate}`, 256, 64, '#103a6b', '#ffffff') }), 70.0, 2.7, 0, -Math.PI / 2);
    // the aircraft outside the window (the real model), apron and sky
    add(new THREE.PlaneGeometry(400, 200).rotateX(-Math.PI / 2), mat(0x6e737b, { roughness: 1 }), 58, -0.02, -110);
    if (this.info.aircraft === 'b738') { const b = new B737Model(); b.loadFull('./models/b738_full.bin').then(() => { const r = b.root; r.matrixAutoUpdate = false; const M = bodyMatrix(Quat.fromEuler(0, 0, Math.PI / 2)); M.setPosition(58, 3.85, -34); r.matrix.copy(M); sc.add(r); }).catch(() => undefined); }
    else { this.model = new AirlinerModel(this.info.aircraft); this.model.load().then(() => { const r = this.model!.root; r.matrixAutoUpdate = false; const M = bodyMatrix(Quat.fromEuler(0, 0, Math.PI / 2)); M.setPosition(58, 3.9, -34); r.matrix.copy(M); sc.add(r); }).catch(() => undefined); }   // nose east, parallel to the windows
    // people: a queue at check-in, strollers in the hall, a queue at security, passengers in the lounge
    const rnd = rng(11), crowd: Person[] = [], pick = () => ({ cloth: Math.floor(rnd() * 10), skin: Math.floor(rnd() * 6) });
    for (let i = 0; i < 9; i++) crowd.push({ x: 7 + i * 1.4 + rnd() * 0.3, z: -3.3 + (rnd() - 0.5) * 0.8, yaw: -Math.PI / 2, ...pick() });
    for (let i = 0; i < 12; i++) { const z = (rnd() - 0.5) * 12; crowd.push({ x: 3 + rnd() * 18, z, yaw: 0, path: [[3 + rnd() * 6, z], [16 + rnd() * 8, z + (rnd() - 0.5) * 3]], speed: 0.7 + rnd() * 0.6, t: rnd() * 30, ...pick() }); }
    for (let i = 0; i < 7; i++) crowd.push({ x: 27.5 + (i % 3) * 0.8, z: -4.2 + i * 1.3 + rnd() * 0.3, yaw: 0, ...pick() });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) if (rnd() < 0.55) crowd.push({ x: 49 + c * 3.6, z: -3 + r * 2.4 - 3, y: 0.46, yaw: -Math.PI / 2, seated: true, ...pick() });
    for (let i = 0; i < 12; i++) { const z = -8 + rnd() * 14; crowd.push({ x: 46 + rnd() * 4, z, yaw: 0, path: [[46 + rnd() * 3, z], [60 + rnd() * 8, z + (rnd() - 0.5) * 4]], speed: 0.8 + rnd() * 0.6, t: rnd() * 40, ...pick() }); }
    for (let i = 0; i < 5; i++) crowd.push({ x: 50 + i * 4.6 + (rnd() - 0.5), z: 9.8, yaw: 0, ...pick() });
    this.people = new PeopleField(crowd); sc.add(this.people.group);
    // markers: a glowing disc at each thing to do
    for (const st of STEPS) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 24), new THREE.MeshBasicMaterial({ color: 0x3cc8ff, transparent: true, opacity: 0.7 })); m.position.set(st.x, 0.03, st.z); sc.add(m); this.markers.push(m); }
    // ropes that block the next zone until the step is done
    for (const [x, z0, z1] of [[26, -5, 5], [44, -5, 5], [72, -1.4, 1.4]] as [number, number, number][]) { const rope = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, z1 - z0), mat(0xc8142c)); rope.position.set(x, 0.9, (z0 + z1) / 2); sc.add(rope); this.ropes.push(rope); }
    function info(s: string) { return s.toUpperCase(); }
  }
  private drawBoard() {
    const { cv, tex } = this.board, g = cv.getContext('2d')!; g.fillStyle = '#0a1226'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#ffd24a'; g.font = '700 22px system-ui'; g.fillText('DEPARTURES', 14, 30); g.fillStyle = '#9aa9c2'; g.font = '14px system-ui'; g.fillText('FLIGHT    TO               GATE   STATUS', 14, 54);
    const rows: [string, string, string, string][] = [[this.info.flight, this.info.to, this.info.gate, this.done[2] ? 'FINAL CALL' : this.done[1] ? 'BOARDING' : 'CHECK-IN'], ['JV 2210', 'AMSTERDAM', '07', 'ON TIME'], ['JV 5513', 'PARIS', '09', 'ON TIME'], ['JV 3302', 'DUBLIN', '14', 'DELAYED'], ['JV 7791', 'MADRID', '02', 'ON TIME']];
    rows.forEach((r, i) => { g.fillStyle = i === 0 ? ((Math.floor(this.t * 2) % 2 && this.done[1]) ? '#fff' : '#3cd48c') : '#e8eef8'; g.font = '700 17px ui-monospace, monospace'; g.fillText(`${r[0].padEnd(9)} ${r[1].toUpperCase().padEnd(16)} ${r[2].padEnd(5)} ${r[3]}`, 14, 84 + i * 32); });
    tex.needsUpdate = true;
  }
  private refreshSteps() {
    this.steps.innerHTML = ['Check in', 'Security', 'Gate', 'Board'].map((n, i) => `<span style="opacity:${i <= this.done.filter(Boolean).length ? 1 : 0.45}">${(this.done[i] ?? this.ended) ? '\u2713' : i + 1} ${n}</span>`).join('<span style="opacity:.4">\u203a</span>');
    const j = this.done.filter(Boolean).length;
    if (this.done[0]) { this.ticket.style.display = 'block'; this.ticket.innerHTML = `<div style="letter-spacing:.14em;font-size:10px;opacity:.6">BOARDING PASS</div><div style="font-size:15px">${this.info.name}</div><div>${this.info.flight} \u00b7 ${this.info.icao} \u2192 ${this.info.to}</div><div>Gate ${this.info.gate} \u00b7 Seat ${this.info.seat}</div>`; }
    void j;
  }
  private interact() {
    const i = this.done.findIndex((d) => !d); if (i < 0 || i > 2) return;
    const st = STEPS[i]; if (Math.hypot(this.x - st.x, this.z - st.z) > 2.2) return;
    if (i === 0 && this.info.seatOptions?.length && !this.chooser) { this.chooseSeat(); return; }
    this.complete(i);
  }
  /** Check-in: a list of seats to choose from (like picking a seat at the desk). */
  private chooseSeat() {
    const el = document.createElement('div'); this.chooser = el; el.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:18px 22px;border-radius:12px;background:rgba(10,20,40,.94);border:1px solid rgba(255,255,255,.2);pointer-events:auto;min-width:300px';
    el.innerHTML = '<div style="letter-spacing:.14em;font-size:12px;opacity:.7;margin-bottom:8px">CHOOSE YOUR SEAT</div>';
    this.info.seatOptions!.forEach((label, k) => { const b = document.createElement('button'); b.className = 'jv-btn ghost'; b.textContent = label; b.style.cssText = 'display:block;width:100%;margin:5px 0;text-align:left'; b.onclick = () => { this.seatIdx = k; this.info.seat = (/Row (\d+[A-Z])/.exec(label)?.[1]) ?? this.info.seat; el.remove(); this.chooser = null; this.complete(0); }; el.appendChild(b); });
    this.hud.appendChild(el);
  }
  private complete(i: number) {
    this.done[i] = true; if (i === 1) this.audio?.announce(`Flight ${this.info.flight} to ${this.info.to} is now boarding at gate ${this.info.gate}.`); else this.audio?.chime(true); this.rects.push(ZONES[i + 1]); this.scene.remove(this.ropes[i]); this.markers[i].visible = false; this.flash = 1; this.refreshSteps(); this.drawBoard();
  }
  update(dt: number) {
    this.t += dt; this.flash = Math.max(0, this.flash - dt); this.people.update(dt);
    if (this.chooser) { this.prompt.style.display = 'none'; return; }
    const fwd = Math.max(-1, Math.min(1, (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - this.touchMove.y)), str = Math.max(-1, Math.min(1, (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.touchMove.x));
    if (fwd || str) this.audio?.step(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    const sp = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3.4 : 1.7) * dt;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), dx = (cy * fwd + sy * str) * sp, dz = (-sy * fwd + cy * str) * sp;   // yaw 0 faces +x; right is (sin, cos)
    [this.x, this.z] = slide(this.rects, this.x, this.z, dx, dz);
    const bob = Math.sin(this.t * 7) * 0.012 * Math.min(1, Math.abs(fwd) + Math.abs(str));
    this.camera.position.set(this.x, 1.65 + bob, this.z);
    this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(this.pitch, this.yaw - Math.PI / 2, 0);   // yaw 0 faces +x
    // prompt and marker pulse
    const i = this.done.findIndex((d) => !d); let p = '';
    if (i >= 0 && i <= 2) { const st = STEPS[i]; this.markers[i].scale.setScalar(1 + 0.12 * Math.sin(this.t * 4)); p = Math.hypot(this.x - st.x, this.z - st.z) < 2.2 ? st.text : `Go to the glowing marker: ${st.name}`; }
    this.prompt.style.display = p ? 'block' : 'none'; this.prompt.textContent = p;
    if (this.done[2] && this.x > 90 && !this.ended) this.finish();
    if (Math.floor(this.t) !== Math.floor(this.t - dt)) this.drawBoard();
    this.scene.background = new THREE.Color(0x9fb6d0).lerp(new THREE.Color(0xffffff), this.flash * 0.15);
  }
  render(r: THREE.WebGLRenderer) { const s = r.getSize(new THREE.Vector2()); this.camera.aspect = s.x / Math.max(1, s.y); this.camera.updateProjectionMatrix(); r.render(this.scene, this.camera); }
  /** Ends the walk (boarding complete or skipped). */
  finish() { if (this.ended) return; this.ended = true; this.onDone?.(this.seatIdx); }
  dispose() { window.removeEventListener('keydown', this.kd); window.removeEventListener('keyup', this.ku); this.hud.remove(); this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); }
}
