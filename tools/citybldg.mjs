// Splits the 3DTGRL city FBX into individual buildings (prototypes) -> public/models/citypack/bldg.json + bldg.bin
// Keeps only facade/window materials, clusters touching meshes by footprint overlap, drops tiny/huge clusters.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
globalThis.self = globalThis; globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(v) {} }) };
const buf = fs.readFileSync(process.argv[2]);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
root.updateMatrixWorld(true);
const KEEP = /^(facade_5|facade_6|NEWFACADE|NEWFACADE_1|Glass_Coated_Black_2|Aluminum_Anodized_DarkGray_1|_Charcoal_2|vLightGray|FrontColor|Glass_Window_Neutral)$/;
const S = 0.0254;
const res = [];
// the pack is a handful of big buildings: Group3 (a tower cluster) and Group24 (another tower); each becomes one prototype
for (const top of root.children) if (/^Group(3|24)$/.test(top.name)) {
  const list = [];
  top.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => KEEP.test(m.name))) { const b = new THREE.Box3().setFromObject(o); list.push({ o, g: o.geometry, b: new THREE.Box3(b.min.clone().multiplyScalar(S), b.max.clone().multiplyScalar(S)) }); } });
  const bb = new THREE.Box3(); list.forEach((p) => bb.union(p.b)); const sz = bb.getSize(new THREE.Vector3());
  let tris = 0; list.forEach((p) => (tris += (p.g.index ? p.g.index.count : p.g.attributes.position.count) / 3));
  console.log(top.name, 'meshes', list.length, 'size m', sz.toArray().map((v) => v.toFixed(0)).join('x'), 'tris', tris);
  res.push({ list, bb, sz, tris });
}
res.sort((a, b) => a.tris - b.tris);
const chunks = [], meta = []; let off = 0;
const push = (ta) => { const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); const o = off; off += b.length + pad; return o; };
const MAXB = 4;
for (const r of res.slice(0, MAXB)) {
  const per = new Map();
  const cx = (r.bb.min.x + r.bb.max.x) / 2, cz = (r.bb.min.z + r.bb.max.z) / 2, y0 = r.bb.min.y;
  for (const p of r.list) {
    const g = p.g, mats = [].concat(p.o.material), pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, idx = g.index ? g.index.array : null;
    const nm = new THREE.Matrix3().getNormalMatrix(p.o.matrixWorld);
    const ranges = g.groups.length ? g.groups : [{ start: 0, count: (idx ? idx.length : pa.count), materialIndex: 0 }];
    for (const rg of ranges) {
      const m = mats[rg.materialIndex] || mats[0]; if (!KEEP.test(m.name)) continue;
      let G = per.get(m.name); if (!G) { G = { m, pos: [], nrm: [], uv: [], idx: [], n: 0 }; per.set(m.name, G); }
      const v = new THREE.Vector3(), n = new THREE.Vector3(); const map = new Map();
      for (let k = rg.start; k < rg.start + rg.count; k++) {
        const vi = idx ? idx[k] : k; let id = map.get(vi);
        if (id === undefined) { id = G.n++; map.set(vi, id); v.fromBufferAttribute(pa, vi).applyMatrix4(p.o.matrixWorld).multiplyScalar(S); G.pos.push(v.x - cx, v.y - y0, v.z - cz); n.fromBufferAttribute(na, vi).applyMatrix3(nm).normalize(); G.nrm.push(n.x, n.y, n.z); G.uv.push(ua ? ua.getX(vi) : 0, ua ? ua.getY(vi) : 0); }
        G.idx.push(id);
      }
    }
  }
  meta.push({ size: r.sz.toArray(), tris: r.tris, mats: [...per.values()].map((G) => ({ name: G.m.name, map: G.m.map ? G.m.map.name.replace(/_texture$/, '') : '', color: G.m.color ? G.m.color.getHex() : 0xcccccc, n: G.n, ni: G.idx.length, pos: push(new Float32Array(G.pos)), nrm: push(new Int8Array(G.nrm.map((x) => Math.round(Math.max(-1, Math.min(1, x)) * 127)))), uv: push(new Float32Array(G.uv)), idx: push(new Uint32Array(G.idx)) })) });
}
fs.writeFileSync(process.argv[3] + '/bldg.bin', Buffer.concat(chunks)); fs.writeFileSync(process.argv[3] + '/bldg.json', JSON.stringify(meta));
console.log('prototypes', meta.length, 'tris', meta.reduce((a, m) => a + m.tris, 0), 'bin MB', (off / 1e6).toFixed(2), 'heights', meta.map((m) => m.size[1].toFixed(0)).slice(0, 30).join(','));
