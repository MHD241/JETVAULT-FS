// JetVault Cockpit Studio: a small 3D editor for building the flight deck by hand.
// Shapes (rounded boxes, rounded cylinders, spheres, cones, tori, capsules, planes, live-screen panels),
// connectors between parts, mirror, snap, undo/redo, save/load, export, and "use in game".
// Access: a passcode kept in this browser only. It keeps casual visitors out; it is not real security.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Design, Part, PartType, DEFAULTS, buildMesh, EYE_STUDIO, ScreenKind } from './parts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE_KEY = 'jetvault.studio.cockpit', PASS_KEY = 'jetvault.studio.pass', USE_KEY = 'jetvault.studio.use';

// ---------------------------------------------------------------- passcode gate
async function sha(s: string) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jv|' + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function gate(): Promise<void> {
  const stored = localStorage.getItem(PASS_KEY);
  $('lockmsg').textContent = stored ? 'Enter your passcode' : 'First visit: choose a passcode (stored in this browser only)';
  return new Promise((res) => {
    const go = async () => {
      const v = ($('pass') as HTMLInputElement).value;
      if (!v) return;
      const h = await sha(v);
      if (!stored) { localStorage.setItem(PASS_KEY, h); } else if (stored !== h) { $('lockmsg').textContent = 'Wrong passcode'; return; }
      $('lock').remove(); res();
    };
    $('unlock').onclick = go; $('pass').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
  });
}

// ---------------------------------------------------------------- state
let design: Design = { version: 1, nextId: 1, parts: [] };
const undoStack: string[] = [], redoStack: string[] = [];
let selected: number | null = null;
let eyeSelected = false;
const getEye = (): [number, number, number] => design.eye ?? [EYE_STUDIO.X, EYE_STUDIO.Y, EYE_STUDIO.Z];
let snap = 0.01;
const snapshot = () => JSON.stringify(design);
function commit() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; autosave(); }
function autosave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(design)); } catch { /* storage full */ } }
function restore(s: string) { design = JSON.parse(s); if (selected !== null && !design.parts.find((p) => p.id === selected)) selected = null; rebuild(); }
const part = (id: number | null) => design.parts.find((p) => p.id === id);

// ---------------------------------------------------------------- scene
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x232830);
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 100); camera.position.set(-1.6, 1.8, -1.6); camera.up.set(0, 1, 0);
const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.set(0.6, 0.9, 0); orbit.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x2a2d33, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-2, 4, -3); scene.add(sun);
const grid = new THREE.GridHelper(4, 40, 0x3a424d, 0x252b33); grid.position.set(0.5, 0, 0); scene.add(grid);
scene.add(new THREE.AxesHelper(0.4));
// reference: pilot eye, the windshield glass plane and the aircraft nose direction
const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0x4f8ef7 })); eye.scale.setScalar(1.6); scene.add(eye);
const eyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4f8ef7, transparent: true, opacity: 0.25, depthTest: false })); eye.add(eyeGlow);
const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.3, 0.02, 0), 0.5, 0x4f8ef7); scene.add(arrow);
const root = new THREE.Group(); scene.add(root);
const gizmo = new TransformControls(camera, renderer.domElement); scene.add(gizmo.getHelper());
gizmo.setTranslationSnap(snap); gizmo.setScaleSnap(0.05); gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
const meshes = new Map<number, THREE.Mesh>();

function placeEye() { eye.position.set(...getEye()); }
function rebuild() {
  gizmo.detach(); placeEye();
  for (const m of meshes.values()) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); root.remove(m); }
  meshes.clear();
  for (const p of design.parts) { const m = buildMesh(p, design.parts); meshes.set(p.id, m); root.add(m); }
  refreshMeshSelection(); renderUI();
}
function refreshPart(p: Part) {
  const old = meshes.get(p.id); if (old) { old.geometry.dispose(); (old.material as THREE.Material).dispose(); root.remove(old); }
  const m = buildMesh(p, design.parts); meshes.set(p.id, m); root.add(m);
  // connectors that use this part follow it
  for (const c of design.parts) if (c.type === 'connector' && (c.a === p.id || c.b === p.id)) { const o = meshes.get(c.id); if (o) { root.remove(o); o.geometry.dispose(); } const n = buildMesh(c, design.parts); meshes.set(c.id, n); root.add(n); }
  if (selected === p.id && p.type !== 'connector') gizmo.attach(meshes.get(p.id)!);
}
function refreshMeshSelection() {
  if (eyeSelected) { gizmo.setMode('translate'); gizmo.attach(eye); return; }
  const p = part(selected);
  if (p && p.type !== 'connector') gizmo.attach(meshes.get(p.id)!); else gizmo.detach();
  for (const m of meshes.values()) { const mat = m.material as THREE.MeshStandardMaterial; if (mat.emissive && (m.userData.partId === selected)) { mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.0); } }
}
function select(id: number | null) { selected = id; eyeSelected = false; refreshMeshSelection(); renderUI(); }

// ---------------------------------------------------------------- editing
function addPart(type: PartType, extra: Partial<Part> = {}) {
  const p: Part = { id: design.nextId++, type, name: type[0].toUpperCase() + type.slice(1) + ' ' + design.nextId, pos: [0.9, 0.9 + (design.parts.length % 5) * 0.02, ((design.parts.length % 7) - 3) * 0.28], rot: [0, 0, 0], color: type === 'screen' ? '#0a0b0c' : '#5a606a', rough: 0.8, metal: 0.05, emissive: 0, d: { ...DEFAULTS[type] }, ...extra };
  if (type === 'screen') { p.screen = 'pfd'; p.rot = [0, -90, 0]; p.pos = [1.45, 1.0, -0.4]; }
  design.parts.push(p); commit(); rebuild(); select(p.id);
}
function bake(p: Part, m: THREE.Mesh) {
  // scaling the gizmo changes the real dimensions (so corner radii stay correct) and resets the scale to 1
  const s = m.scale; const d = p.d, avg = (s.x + s.z) / 2, all = (s.x + s.y + s.z) / 3;
  switch (p.type) {
    case 'box': d.w *= s.x; d.h *= s.y; d.d *= s.z; break;
    case 'cylinder': d.rt *= avg; d.rb *= avg; d.h *= s.y; break;
    case 'sphere': d.r *= all; break;
    case 'cone': d.r *= avg; d.h *= s.y; break;
    case 'torus': d.R *= all; d.tube *= all; break;
    case 'capsule': d.r *= avg; d.len *= s.y; break;
    case 'plane': case 'screen': d.w *= s.x; d.h *= s.y; break;
  }
  for (const k of Object.keys(d)) d[k] = Math.round(d[k] * 10000) / 10000;
}
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !(e as unknown as { value: boolean }).value;
  if (!(e as unknown as { value: boolean }).value && eyeSelected) { design.eye = eye.position.toArray().map((v) => Math.round(v * 1000) / 1000) as [number, number, number]; commit(); renderRight(); return; }
  const p = part(selected), m = p && meshes.get(p.id);
  if (!(e as unknown as { value: boolean }).value && p && m && !eyeSelected) {
    p.pos = m.position.toArray().map((v) => Math.round(v * 10000) / 10000) as [number, number, number];
    const e2 = new THREE.Euler().setFromQuaternion(m.quaternion, 'YXZ');
    p.rot = [e2.x, e2.y, e2.z].map((v) => Math.round((v * 180) / Math.PI * 10) / 10) as [number, number, number];
    if (gizmo.mode === 'scale') bake(p, m);
    commit(); refreshPart(p); renderUI();
  }
});
gizmo.addEventListener('objectChange', () => { const p = part(selected); if (p && p.type === 'connector') return; });

function duplicate() {
  const p = part(selected); if (!p || p.type === 'connector') return;
  const c: Part = JSON.parse(JSON.stringify(p)); c.id = design.nextId++; c.name = p.name + ' copy'; c.pos[0] += 0.05;
  design.parts.push(c); commit(); rebuild(); select(c.id);
}
function mirror() {
  const p = part(selected); if (!p || p.type === 'connector') return;
  const c: Part = JSON.parse(JSON.stringify(p)); c.id = design.nextId++; c.name = p.name + ' (mirror)'; c.pos[2] = -c.pos[2]; c.rot[1] = -c.rot[1]; c.rot[0] = -c.rot[0];
  design.parts.push(c); commit(); rebuild(); select(c.id);
}
function remove() {
  if (selected === null) return;
  design.parts = design.parts.filter((p) => p.id !== selected && !(p.type === 'connector' && (p.a === selected || p.b === selected)));
  selected = null; commit(); rebuild();
}
function connect() {
  const others = design.parts.filter((p) => p.type !== 'connector');
  const s = part(selected);
  if (!s || s.type === 'connector' || others.length < 2) { msg('Select a part first (and have at least two parts); the connector then joins it to the part you pick in the panel'); return; }
  const other = others.find((p) => p.id !== s.id)!;
  addPart('connector', { a: s.id, b: other.id, color: '#2a2d32', pos: [0, 0, 0] });
}
function msg(s: string) { $('msg').textContent = s; }

// ---------------------------------------------------------------- UI
function renderTop() {
  const t = $('top'); t.innerHTML = '';
  const b = (label: string, fn: () => void, on = false) => { const e = document.createElement('button'); e.textContent = label; e.onclick = fn; if (on) e.classList.add('on'); t.appendChild(e); return e; };
  const sep = () => { const s = document.createElement('div'); s.className = 'sep'; t.appendChild(s); };
  b('Undo', () => { if (undoStack.length > 1) { redoStack.push(undoStack.pop()!); restore(undoStack[undoStack.length - 1]); autosave(); } });
  b('Redo', () => { const s = redoStack.pop(); if (s) { undoStack.push(s); restore(s); autosave(); } }); sep();
  for (const [label, mode] of [['Move (W)', 'translate'], ['Rotate (E)', 'rotate'], ['Size (R)', 'scale']] as const) b(label, () => { gizmo.setMode(mode); renderTop(); }, gizmo.mode === mode); sep();
  b(snap ? `Snap ${snap * 100} cm` : 'Snap off', () => { snap = snap === 0.01 ? 0.05 : snap === 0.05 ? 0 : 0.01; gizmo.setTranslationSnap(snap || null); renderTop(); }, !!snap); sep();
  b('Duplicate (D)', duplicate); b('Mirror L/R (M)', mirror); b('Connector (C)', connect); b('Delete (Del)', remove); sep();
  b('Save file', save); b('Load file', load); b('Export GLB', exportGlb); sep();
  const use = localStorage.getItem(USE_KEY) === '1';
  b(use ? 'In the game: ON' : 'Use in the game', () => { localStorage.setItem(USE_KEY, use ? '0' : '1'); autosave(); msg(use ? 'The game will use its built-in cockpit' : 'Saved. Open the game (same browser) and pick the 737: it now loads your cockpit'); renderTop(); }, use);
  b('Select eye (camera)', () => { selected = null; eyeSelected = true; refreshMeshSelection(); renderUI(); }, eyeSelected);
  b('View from eye', () => { const e = getEye(); camera.position.set(e[0], e[1], e[2]); orbit.target.set(e[0] + 1, e[1] - 0.2, e[2]); });
}
function renderLeft() {
  const l = $('left'); l.innerHTML = '<h4>Add shape</h4>';
  const names: [PartType, string][] = [['box', 'Rounded box'], ['cylinder', 'Cylinder (rounded)'], ['sphere', 'Sphere'], ['cone', 'Cone'], ['torus', 'Ring / torus'], ['capsule', 'Capsule / handle'], ['plane', 'Flat panel'], ['screen', 'Live screen']];
  for (const [t, n] of names) { const e = document.createElement('button'); e.textContent = n; e.onclick = () => addPart(t); l.appendChild(e); }
  l.insertAdjacentHTML('beforeend', '<h4>Keys</h4><div style="color:#8b94a0;line-height:1.6">W/E/R move, rotate, size<br>D duplicate, M mirror<br>C connector, Del delete<br>Ctrl+Z / Ctrl+Y undo, redo<br>Click a part to select<br>Drag = orbit, wheel = zoom, right drag = pan</div>');
}
function num(parent: HTMLElement, label: string, v: number, min: number, max: number, step: number, set: (n: number) => void) {
  const r = document.createElement('div'); r.className = 'row';
  const lb = document.createElement('label'); lb.textContent = label; const rg = document.createElement('input'); rg.type = 'range'; rg.min = String(min); rg.max = String(max); rg.step = String(step); rg.value = String(v);
  const nb = document.createElement('input'); nb.type = 'number'; nb.step = String(step); nb.value = String(Math.round(v * 10000) / 10000);
  rg.oninput = () => { nb.value = rg.value; set(+rg.value); }; rg.onchange = () => commit(); nb.onchange = () => { rg.value = nb.value; set(+nb.value); commit(); };
  r.append(lb, rg, nb); parent.appendChild(r);
}
function renderRight() {
  const R = $('right'); R.innerHTML = `<h4>Parts (${design.parts.length})</h4><div id="list"></div>`;
  const list = $('list');
  for (const p of design.parts) { const d = document.createElement('div'); d.textContent = p.name; if (p.id === selected) d.className = 'sel'; d.onclick = () => select(p.id); list.appendChild(d); }
  if (eyeSelected) {
    R.insertAdjacentHTML('beforeend', '<h4>Pilot eye = the game camera</h4><div style="color:#8b94a0;margin-bottom:8px">Drag the blue ball, or type exact positions. The game views from here.</div>');
    (['X forward', 'Y up', 'Z right'] as const).forEach((l, i) => num(R, l, getEye()[i], -3, 3, 0.005, (n) => { const e = getEye(); e[i] = n; design.eye = e; placeEye(); }));
    const rs = document.createElement('button'); rs.textContent = 'Reset to default seat'; rs.onclick = () => { delete design.eye; commit(); placeEye(); renderRight(); }; R.appendChild(rs); return;
  }
  const p = part(selected); if (!p) { R.insertAdjacentHTML('beforeend', '<div style="color:#8b94a0">Nothing selected. Add a shape on the left, or click a part.</div>'); return; }
  const redo = () => refreshPart(p);
  R.insertAdjacentHTML('beforeend', '<h4>Part</h4>');
  const nm = document.createElement('input'); nm.type = 'text'; nm.value = p.name; nm.onchange = () => { p.name = nm.value; commit(); renderRight(); }; R.appendChild(nm);
  if (p.type !== 'connector') {
    R.insertAdjacentHTML('beforeend', '<h4>Position (m) and rotation (deg)</h4>');
    (['X forward', 'Y up', 'Z right'] as const).forEach((l, i) => num(R, l, p.pos[i], -3, 3, 0.005, (n) => { p.pos[i] = n; redo(); }));
    (['Rot X', 'Rot Y', 'Rot Z'] as const).forEach((l, i) => num(R, l, p.rot[i], -180, 180, 1, (n) => { p.rot[i] = n; redo(); }));
  }
  R.insertAdjacentHTML('beforeend', '<h4>Shape</h4>');
  const dims: Record<string, [string, number, number, number][]> = {
    box: [['Width', 0.01, 3, 0.005], ['Height', 0.01, 3, 0.005], ['Depth', 0.01, 3, 0.005], ['Round edges', 0, 0.3, 0.001], ['Smoothness', 1, 10, 1]],
    cylinder: [['Radius top', 0.005, 1, 0.002], ['Radius bottom', 0.005, 1, 0.002], ['Height', 0.01, 3, 0.005], ['Sides', 6, 64, 1], ['Round edges', 0, 0.2, 0.001]],
    sphere: [['Radius', 0.005, 1, 0.002]], cone: [['Radius', 0.005, 1, 0.002], ['Height', 0.01, 2, 0.005], ['Sides', 4, 64, 1]],
    torus: [['Ring radius', 0.02, 1, 0.002], ['Tube radius', 0.002, 0.2, 0.001]], capsule: [['Radius', 0.003, 0.5, 0.001], ['Length', 0.01, 2, 0.005]],
    plane: [['Width', 0.01, 3, 0.005], ['Height', 0.01, 3, 0.005]], screen: [['Width', 0.02, 1, 0.005], ['Height', 0.02, 1, 0.005]], connector: [['Thickness', 0.002, 0.2, 0.001], ['Sides', 4, 32, 1]],
  };
  const keys = Object.keys(DEFAULTS[p.type]);
  dims[p.type].forEach((dm, i) => num(R, dm[0], p.d[keys[i]], dm[1], dm[2], dm[3], (n) => { p.d[keys[i]] = n; redo(); }));
  if (p.type === 'screen') {
    const s = document.createElement('select'); (['pfd', 'nd', 'eng', 'mcp'] as ScreenKind[]).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = { pfd: 'Primary flight display', nd: 'Navigation display', eng: 'Engine display', mcp: 'Autopilot panel' }[k]; if (p.screen === k) o.selected = true; s.appendChild(o); });
    s.onchange = () => { p.screen = s.value as ScreenKind; commit(); }; R.insertAdjacentHTML('beforeend', '<h4>Shows (in the game)</h4>'); R.appendChild(s);
  }
  if (p.type === 'connector') {
    const mk = (label: string, cur: number | undefined, set: (id: number) => void) => { const s = document.createElement('select'); design.parts.filter((x) => x.type !== 'connector').forEach((x) => { const o = document.createElement('option'); o.value = String(x.id); o.textContent = x.name; if (x.id === cur) o.selected = true; s.appendChild(o); }); s.onchange = () => { set(+s.value); commit(); refreshPart(p); }; R.insertAdjacentHTML('beforeend', `<h4>${label}</h4>`); R.appendChild(s); };
    mk('From', p.a, (i) => { p.a = i; }); mk('To', p.b, (i) => { p.b = i; });
  }
  if (p.type !== 'screen') {
    R.insertAdjacentHTML('beforeend', '<h4>Material</h4>');
    const c = document.createElement('input'); c.type = 'color'; c.value = p.color; c.oninput = () => { p.color = c.value; redo(); }; c.onchange = () => commit(); R.appendChild(c);
    num(R, 'Roughness', p.rough, 0, 1, 0.01, (n) => { p.rough = n; redo(); }); num(R, 'Metal', p.metal, 0, 1, 0.01, (n) => { p.metal = n; redo(); }); num(R, 'Glow', p.emissive, 0, 2, 0.01, (n) => { p.emissive = n; redo(); });
  }
}
function renderUI() { renderTop(); renderRight(); }

// ---------------------------------------------------------------- files
function download(name: string, data: BlobPart, type: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function save() { download('jetvault-cockpit.json', JSON.stringify(design, null, 1), 'application/json'); msg('Saved a copy to your downloads. It is also autosaved in this browser'); }
function load() { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; try { design = JSON.parse(await f.text()); commit(); selected = null; rebuild(); } catch { msg('That file is not a cockpit design'); } }; i.click(); }
function exportGlb() { new GLTFExporter().parse(root, (r) => download('cockpit.glb', r as ArrayBuffer, 'model/gltf-binary'), () => msg('Export failed'), { binary: true }); }

// ---------------------------------------------------------------- input
const ray = new THREE.Raycaster();
let down = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || gizmo.dragging) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const eh = ray.intersectObject(eyeGlow, false)[0], hit = ray.intersectObjects([...meshes.values()].filter((m) => m.visible), false)[0];
  if (eh && (!hit || eh.distance <= hit.distance + 0.05)) { selected = null; eyeSelected = true; refreshMeshSelection(); renderUI(); return; }
  select(hit ? (hit.object.userData.partId as number) : null);
});
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement; if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (undoStack.length > 1) { redoStack.push(undoStack.pop()!); restore(undoStack[undoStack.length - 1]); autosave(); } }
  else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); const s = redoStack.pop(); if (s) { undoStack.push(s); restore(s); autosave(); } }
  else if (k === 'w') { gizmo.setMode('translate'); renderTop(); } else if (k === 'e') { gizmo.setMode('rotate'); renderTop(); } else if (k === 'r') { gizmo.setMode('scale'); renderTop(); }
  else if (k === 'd') duplicate(); else if (k === 'm') mirror(); else if (k === 'c') connect(); else if (k === 'delete' || k === 'backspace') remove();
});
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize);
function frame() { orbit.update(); renderer.render(scene, camera); requestAnimationFrame(frame); }

// ---------------------------------------------------------------- start
gate().then(() => {
  try { const s = localStorage.getItem(SAVE_KEY); if (s) design = JSON.parse(s); } catch { /* start empty */ }
  undoStack.push(snapshot()); renderLeft(); rebuild(); resize(); frame();
  msg(design.parts.length ? 'Loaded your last design' : 'Empty design: add a shape on the left. The blue dot is the pilot\'s eye and the arrow points to the nose');
});
