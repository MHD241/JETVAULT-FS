// Converts a downloaded airliner GLB into a compact runtime pack (public/models/airliners/<id>.json + .bin + textures):
//  - node transforms baked, rotated into the game's body frame (x nose, y right, z down), scaled to the real length, nose at +length/2, wheels' lowest point at z = spawnHeight
//  - triangles reduced with meshoptimizer's simplifier to a budget, vertices compacted, merged per material
// usage: node tools/airliners/convert.mjs <id>   (settings below)
import fs from 'node:fs';
import { MeshoptSimplifier } from '/home/user/JETVAULT-FS/node_modules/meshoptimizer/meshopt_simplifier.js';
import { readGlb } from './glb.mjs';
await MeshoptSimplifier.ready;
const U = '/root/.claude/uploads/6d0491ca-5ad0-5833-9ea8-60236238eee9/';
const CFG = {
  a350: { file: U + 'af552d17-a350_v5.glb', length: 73.79, budget: 110000, spawn: 7.2 },
  a340: { file: U + 'd455ea20-lufthansa_airbus_a340-600.glb', length: 75.36, budget: 60000, spawn: 6.9 },
  a320_cockpit: { file: '/tmp/claude-0/cp/a320_cockpit_2.glb', length: 37.57, budget: 200000, spawn: 3.8, cockpit: true },
  a320: { file: U + '2e0aa408-airbus_a320-200.glb', length: 37.57, budget: 100000, spawn: 3.8 },
};
const id = process.argv[2], c = CFG[id]; if (!c) throw new Error('unknown id');
let { j, prims, image } = readGlb(c.file);
if (c.cockpit) prims = prims.filter((_, i) => i >= 7 && i <= 68);   // flight-deck parts only (the airframe, gear and cabin shell are left out)
// bounds, scale, nose direction (the tallest part, the fin, is at the tail end)
const B = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; let finX = 0, finY = -1e9;
for (const p of prims) for (let k = 0; k < p.pos.length; k += 3) { for (let a = 0; a < 3; a++) { B.min[a] = Math.min(B.min[a], p.pos[k + a]); B.max[a] = Math.max(B.max[a], p.pos[k + a]); } if (p.pos[k + 1] > finY) { finY = p.pos[k + 1]; finX = p.pos[k]; } }
if (c.cockpit) { B.min = [-4.3356, -0.9936, 0]; B.max = [4.335, 1.9567, 9.112]; }
const cx = (B.min[0] + B.max[0]) / 2, cz = (B.min[2] + B.max[2]) / 2, scale = c.length / (c.cockpit ? 9.112 : B.max[0] - B.min[0]);
const sign = finX > cx ? -1 : 1;   // fin at +x -> nose at -x -> flip
console.log(id, 'scale', scale.toFixed(4), 'nose', sign > 0 ? '+x' : '-x', 'size m', ((B.max[0] - B.min[0]) * scale).toFixed(1), ((B.max[1] - B.min[1]) * scale).toFixed(1), ((B.max[2] - B.min[2]) * scale).toFixed(1));
let totalTris = 0; for (const p of prims) totalTris += p.idx.length / 3;
const ratio = Math.min(1, c.budget / totalTris);
const outDir = '/home/user/JETVAULT-FS/public/models/airliners/'; fs.mkdirSync(outDir, { recursive: true });
const byMat = new Map();
for (const p of prims) {
  const n = p.pos.length / 3, P = new Float32Array(p.pos.length), N = p.nrm ? new Float32Array(p.pos.length) : null;
  for (let k = 0; k < n; k++) {
    const X = p.pos[3 * k] - cx, Y = p.pos[3 * k + 1] - B.min[1], Z = p.pos[3 * k + 2] - cz;
    if (c.cockpit) {   // model: x right, y up, nose at -z  ->  body: x nose (centred), y right, z down
      const mx = p.pos[3 * k], my = p.pos[3 * k + 1], mz = p.pos[3 * k + 2];
      P[3 * k] = (c.length / 2) - mz * scale; P[3 * k + 1] = mx * scale; P[3 * k + 2] = c.spawn - (my - B.min[1]) * scale;
      if (N) { N[3 * k] = -p.nrm[3 * k + 2]; N[3 * k + 1] = p.nrm[3 * k]; N[3 * k + 2] = -p.nrm[3 * k + 1]; }
      continue;
    }
    P[3 * k] = sign * X * scale; P[3 * k + 1] = sign * Z * scale; P[3 * k + 2] = c.spawn - Y * scale;
    if (N) { N[3 * k] = sign * p.nrm[3 * k]; N[3 * k + 1] = sign * p.nrm[3 * k + 2]; N[3 * k + 2] = -p.nrm[3 * k + 1]; }
  }
  // the mirror (sign) or the Y->-Z change flips handedness: z = -y with y,z swapped keeps a right-handed frame; for sign=-1 both x and y flip (a rotation), so winding is kept
  let idx = p.idx; const tris = idx.length / 3;
  if (ratio < 1 && tris > 300) {
    const target = Math.max(300 * 3, Math.floor(tris * ratio) * 3);
    let src = idx;
    if (c.cockpit) { const rep = new Int32Array(n), seen = new Map(); for (let v = 0; v < n; v++) { const key = Math.round(P[3 * v] * 2000) + ',' + Math.round(P[3 * v + 1] * 2000) + ',' + Math.round(P[3 * v + 2] * 2000); let r = seen.get(key); if (r === undefined) { r = v; seen.set(key, v); } rep[v] = r; } src = Uint32Array.from(idx, (v) => rep[v]); }
    const [ni] = MeshoptSimplifier.simplify(src, P, 3, target, c.cockpit ? 0.05 : 0.02); idx = ni;
  }
  // compact
  const remap = new Int32Array(n).fill(-1); let m = 0; for (const v of idx) if (remap[v] < 0) remap[v] = m++;
  const cp = new Float32Array(m * 3), cn = new Float32Array(m * 3), cu = new Float32Array(m * 2);
  for (let v = 0; v < n; v++) { const r = remap[v]; if (r < 0) continue; cp.set(P.subarray(3 * v, 3 * v + 3), 3 * r); if (N) cn.set(N.subarray(3 * v, 3 * v + 3), 3 * r); if (p.uv) cu.set(p.uv.subarray(2 * v, 2 * v + 2), 2 * r); }
  const ci = new Uint32Array(idx.length); for (let k = 0; k < idx.length; k++) ci[k] = remap[idx[k]];
  let G = byMat.get(p.mat); if (!G) { G = { pos: [], nrm: [], uv: [], idx: [], n: 0 }; byMat.set(p.mat, G); }
  for (const x of cp) G.pos.push(x); for (const x of cn) G.nrm.push(x); for (const x of cu) G.uv.push(x); for (const x of ci) G.idx.push(x + G.n); G.n += m;
}
const chunks = [], mats = []; let off = 0, outTris = 0;
const push = (ta) => { const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength), pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); const o = off; off += b.length + pad; return o; };
const texOut = new Map();
for (const [mi, G] of byMat) {
  const gm = j.materials?.[mi] ?? {}, pbr = gm.pbrMetallicRoughness ?? {}, bc = pbr.baseColorFactor ?? [1, 1, 1, 1];
  let map = '';
  const ti = pbr.baseColorTexture?.index, src = ti !== undefined ? j.textures[ti].source : undefined;
  if (src !== undefined) { if (!texOut.has(src)) { const f = outDir + `${id}_tex${src}.src`; fs.writeFileSync(f, image(src)); texOut.set(src, `${id}_tex${src}.jpg`); } map = texOut.get(src); }
  const nrm = new Int8Array(G.nrm.length); for (let i = 0; i < nrm.length; i++) nrm[i] = Math.round(Math.max(-1, Math.min(1, G.nrm[i])) * 127);
  outTris += G.idx.length / 3;
  mats.push({ name: gm.name ?? 'mat' + mi, map, color: bc.slice(0, 3), opacity: gm.alphaMode === 'BLEND' ? bc[3] : 1, metal: pbr.metallicFactor ?? 0, rough: pbr.roughnessFactor ?? 0.6, n: G.n, ni: G.idx.length, pos: push(new Float32Array(G.pos)), nrm: push(nrm), uv: push(new Float32Array(G.uv)), idx: push(new Uint32Array(G.idx)) });
}
fs.writeFileSync(outDir + id + '.bin', Buffer.concat(chunks));
fs.writeFileSync(outDir + id + '.json', JSON.stringify({ id, length: c.length, spawn: c.spawn, span: (B.max[2] - B.min[2]) * scale, height: (B.max[1] - B.min[1]) * scale, materials: mats }));
console.log(id, 'tris', totalTris, '->', outTris, 'materials', mats.length, 'bin MB', (off / 1e6).toFixed(2), 'textures', [...texOut.values()].join(','));
