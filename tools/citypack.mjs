// Converts the CGTrader "City Buildings" FBX (boy... 3DTGRL) into a compact runtime pack: public/models/citypack/pack.json + pack.bin
// usage: node tools/citypack.mjs city.fbx out_dir   (units are inches; scaled to metres, ground at y=0, centred on x/z)
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
globalThis.self = globalThis; globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(v) {} }) };
const buf = fs.readFileSync(process.argv[2]);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const S = 0.0254;
root.updateMatrixWorld(true);
const groups = new Map(); // material key -> {mat, pos[], nrm[], uv[], idx[]}
let skipped = 0;
root.traverse((o) => {
  if (!o.isMesh) return;
  if (/light/i.test(o.name) || /light/i.test(o.parent?.name || '')) { skipped++; return; }
  const g = o.geometry, mats = [].concat(o.material);
  const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
  const idx = g.index ? g.index.array : null;
  const triCount = (idx ? idx.length : pa.count) / 3;
  const ranges = g.groups.length ? g.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
  for (const r of ranges) {
    const m = mats[r.materialIndex] || mats[0];
    const key = m.name || 'mat';
    let G = groups.get(key);
    if (!G) { G = { m, map: m.map?.name?.replace(/_texture$/, '') || '', pos: [], nrm: [], uv: [], idx: [], n: 0 }; groups.set(key, G); }
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const remap = new Map();
    for (let k = r.start; k < r.start + r.count; k++) {
      const vi = idx ? idx[k] : k;
      let id = remap.get(vi);
      if (id === undefined) {
        id = G.n++; remap.set(vi, id);
        v.fromBufferAttribute(pa, vi).applyMatrix4(o.matrixWorld).multiplyScalar(S); G.pos.push(v.x, v.y, v.z);
        if (na) { nn.fromBufferAttribute(na, vi).applyMatrix3(nm).normalize(); } else nn.set(0, 1, 0);
        G.nrm.push(nn.x, nn.y, nn.z);
        G.uv.push(ua ? ua.getX(vi) : 0, ua ? ua.getY(vi) : 0);
      }
      G.idx.push(id);
    }
  }
});
// ground at y=0 (lowest vertex), centre x/z
let minY = 1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = -1e9;
for (const G of groups.values()) for (let i = 0; i < G.pos.length; i += 3) { minX = Math.min(minX, G.pos[i]); maxX = Math.max(maxX, G.pos[i]); minY = Math.min(minY, G.pos[i + 1]); maxY = Math.max(maxY, G.pos[i + 1]); minZ = Math.min(minZ, G.pos[i + 2]); maxZ = Math.max(maxZ, G.pos[i + 2]); }
const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
const chunks = [], meta = [];
let off = 0;
const push = (ta) => { const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); const o = off; off += b.length + pad; return o; };
let tris = 0;
for (const [key, G] of groups) {
  const pos = new Float32Array(G.pos.length), nrm = new Int8Array(G.nrm.length), uv = new Float32Array(G.uv);
  for (let i = 0; i < G.pos.length; i += 3) { pos[i] = G.pos[i] - cx; pos[i + 1] = G.pos[i + 1] - minY; pos[i + 2] = G.pos[i + 2] - cz; }
  for (let i = 0; i < G.nrm.length; i++) nrm[i] = Math.round(Math.max(-1, Math.min(1, G.nrm[i])) * 127);
  const index = new Uint32Array(G.idx);
  tris += index.length / 3;
  meta.push({ name: key, map: G.map, color: G.m.color ? G.m.color.getHex() : 0xcccccc, opacity: G.m.opacity ?? 1, n: G.n, ni: index.length, pos: push(pos), nrm: push(nrm), uv: push(uv), idx: push(index) });
}
fs.mkdirSync(process.argv[3], { recursive: true });
fs.writeFileSync(process.argv[3] + '/pack.bin', Buffer.concat(chunks));
fs.writeFileSync(process.argv[3] + '/pack.json', JSON.stringify({ size: [maxX - minX, maxY - minY, maxZ - minZ], materials: meta }));
console.log('materials', meta.length, 'triangles', tris, 'skipped lights', skipped, 'size m', (maxX - minX).toFixed(0), (maxY - minY).toFixed(0), (maxZ - minZ).toFixed(0), 'bin MB', (off / 1e6).toFixed(1));
console.log(meta.map((m) => `${m.name}[${m.map}] ${m.ni / 3}t op${m.opacity}`).join('\n'));
