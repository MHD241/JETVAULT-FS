import fs from 'fs';
import { MeshoptEncoder } from '/home/user/JETVAULT-FS/node_modules/meshoptimizer/meshopt_encoder.js';
await MeshoptEncoder.ready;
const [src, dst] = [process.argv[2], process.argv[3]];
const b = fs.readFileSync(src);
const jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString());
const bin = b.slice(20 + jl + 8);
const out = [], nbv = [], nac = []; let off = 0;
const place = (buf, extra) => { while (off % 4) { out.push(Buffer.alloc(1)); off++; } nbv.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...extra }); out.push(Buffer.from(buf)); off += buf.length; return nbv.length - 1; };
const f32 = (a) => { const bv = j.bufferViews[a.bufferView]; const o = (bv.byteOffset || 0) + (a.byteOffset || 0); const c = new Float32Array(a.count * 3); for (let i = 0; i < a.count * 3; i++) c[i] = bin.readFloatLE(o + i * 4); return c; };
const idx = (a) => { const bv = j.bufferViews[a.bufferView]; const o = (bv.byteOffset || 0) + (a.byteOffset || 0); const c = new Uint32Array(a.count); for (let i = 0; i < a.count; i++) c[i] = a.componentType === 5125 ? bin.readUInt32LE(o + i * 4) : bin.readUInt16LE(o + i * 2); return c; };
let tris = 0;
for (const m of j.meshes) for (const p of m.primitives) {
  const pa = j.accessors[p.attributes.POSITION], na = j.accessors[p.attributes.NORMAL];
  const P = f32(pa), N = f32(na);
  const pv = place(Buffer.from(MeshoptEncoder.encodeFilterExp(P, pa.count, 12, 16)).length ? Buffer.alloc(0) : Buffer.alloc(0), {});
  nbv.pop(); out.pop();
  // positions: exponent filter (16-bit mantissa) then vertex-buffer coding
  const pf = MeshoptEncoder.encodeFilterExp(P, pa.count, 12, 16);
  const pc = MeshoptEncoder.encodeVertexBuffer(pf, pa.count, 12);
  const pbv = place(pc, { byteStride: 12, target: 34962, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 0, byteStride: 12, count: pa.count, mode: 'ATTRIBUTES', filter: 'EXPONENTIAL' } } });
  nbv[pbv].extensions.EXT_meshopt_compression.byteOffset = nbv[pbv].byteOffset; nbv[pbv].extensions.EXT_meshopt_compression.byteLength = pc.length; nbv[pbv].byteLength = pa.count * 12; delete nbv[pbv].byteOffset; nbv[pbv].buffer = 1;
  // normals: octahedral 8-bit in 4-byte vertices
  const N4 = new Float32Array(pa.count * 4); for (let i = 0; i < pa.count; i++) { N4[i*4] = N[i*3]; N4[i*4+1] = N[i*3+1]; N4[i*4+2] = N[i*3+2]; N4[i*4+3] = 0; }
  const nf = MeshoptEncoder.encodeFilterOct(N4, pa.count, 4, 8);
  const nc = MeshoptEncoder.encodeVertexBuffer(nf, pa.count, 4);
  const nbvi = place(nc, { byteStride: 4, target: 34962, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: nc.length, byteStride: 4, count: pa.count, mode: 'ATTRIBUTES', filter: 'OCTAHEDRAL' } } });
  nbv[nbvi].extensions.EXT_meshopt_compression.byteOffset = nbv[nbvi].byteOffset; nbv[nbvi].byteLength = pa.count * 4; delete nbv[nbvi].byteOffset; nbv[nbvi].buffer = 1;
  const I = idx(j.accessors[p.indices]); tris += I.length / 3;
  const I32 = new Uint32Array(I); const ic = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(I32.buffer), I32.length, 4);
  const ibv = place(ic, { target: 34963, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: ic.length, byteStride: 4, count: I32.length, mode: 'TRIANGLES' } } });
  nbv[ibv].extensions.EXT_meshopt_compression.byteOffset = nbv[ibv].byteOffset; nbv[ibv].byteLength = I32.length * 4; delete nbv[ibv].byteOffset; nbv[ibv].buffer = 1;
  const a0 = nac.length;
  nac.push({ bufferView: pbv, componentType: 5126, count: pa.count, type: 'VEC3', min: pa.min, max: pa.max });
  nac.push({ bufferView: nbvi, componentType: 5120, normalized: true, count: pa.count, type: 'VEC3' });
  nac.push({ bufferView: ibv, componentType: 5125, count: I32.length, type: 'SCALAR' });
  p.attributes = { POSITION: a0, NORMAL: a0 + 1 }; p.indices = a0 + 2;
}
j.accessors = nac; j.bufferViews = nbv;
const comp = Buffer.concat(out);
// buffer 0 = fallback (empty, uncompressed size), buffer 1 = the compressed data
const fallbackLen = nbv.reduce((s, v) => s + v.byteLength, 0);
j.buffers = [{ byteLength: comp.length }];
for (const v of nbv) { if (v.buffer === 1) v.buffer = 0; }
// meshopt: the compressed payload sits in buffer 0 at the extension offset; the bufferView itself points at a fallback buffer
j.buffers = [{ byteLength: comp.length }, { byteLength: fallbackLen, extensions: { EXT_meshopt_compression: { fallback: true } } }];
for (const v of nbv) { v.buffer = 1; v.byteOffset = 0; }
let o2 = 0; for (const v of nbv) { v.byteOffset = o2; o2 += v.byteLength; }
j.extensionsUsed = ['EXT_meshopt_compression']; j.extensionsRequired = ['EXT_meshopt_compression'];
let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 32)]);
let body = comp; body = Buffer.concat([body, Buffer.alloc((4 - body.length % 4) % 4)]);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4E4F534A, 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(body.length, 0); c2.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(dst, Buffer.concat([h, c1, js, c2, body]));
console.log('triangles', tris, '->', (fs.statSync(dst).size / 1e6).toFixed(1), 'MB');
