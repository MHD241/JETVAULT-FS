// Imported .glb models for the Cockpit Studio, kept in the browser's IndexedDB (too big for localStorage).
// Shared by the studio and the game (same origin, same browser).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DB = 'jetvault-studio', STORE = 'models';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function putModel(id: string, buf: ArrayBuffer) {
  const db = await open();
  await new Promise<void>((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(buf, id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function getModel(id: string): Promise<ArrayBuffer | null> {
  const db = await open();
  return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(id); q.onsuccess = () => res((q.result as ArrayBuffer) ?? null); q.onerror = () => rej(q.error); });
}

/** glTF binary check: returns an error message, or null when the file is a usable glTF 2.0 .glb. */
export function checkGlb(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  if (buf.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) return 'That is not a .glb file';
  if (v.getUint32(4, true) !== 2) return 'This .glb is the old glTF 1.0 format; convert it to glTF 2.0 first (for example by opening it in Blender and exporting .glb)';
  return null;
}

const cache = new Map<string, Promise<THREE.Group>>();
function parse(buf: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((res, rej) => new GLTFLoader().parse(buf.slice(0), '', (g) => res(g.scene), rej));
}
export function loadScene(id: string): Promise<THREE.Group | null> {
  let p = cache.get(id);
  if (!p) { p = getModel(id).then((b) => { if (!b) throw new Error('model missing'); return parse(b); }); cache.set(id, p); }
  return p.then((g) => g.clone(true)).catch(() => null);
}
export async function measure(buf: ArrayBuffer) {
  const g = await parse(buf), box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
  return { size, max: Math.max(size.x, size.y, size.z) };
}
/** Adds the stored model as a child of `holder`, centred on its own bounding box. */
export async function attachModel(holder: THREE.Object3D, modelId: string) {
  const g = await loadScene(modelId); if (!g) return;
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
  g.position.sub(c);
  g.traverse((o) => { o.frustumCulled = false; const m = o as THREE.Mesh; if (m.isMesh) m.userData.partId = holder.userData.partId; });
  holder.add(g);
}
export const toBase64 = (buf: ArrayBuffer) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const fromBase64 = (b: string) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
