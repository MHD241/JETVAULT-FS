// Minimal GLB reader: returns baked primitives {name, mat, pos, nrm, uv, idx} in the model's world frame (node matrices applied), plus the material list and images.
import * as THREE from 'three';
import fs from 'node:fs';
export function readGlb(file) {
  const buf = fs.readFileSync(file), jl = buf.readUInt32LE(12), j = JSON.parse(buf.subarray(20, 20 + jl).toString()), bin = buf.subarray(20 + jl + 8);
  const acc = (i) => { const a = j.accessors[i], bv = j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], o = (bv.byteOffset || 0) + (a.byteOffset || 0), ct = a.componentType, sz = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[ct], st = bv.byteStride || n * sz; const out = new (ct === 5126 ? Float32Array : ct === 5125 ? Uint32Array : ct === 5123 ? Uint16Array : Uint8Array)(a.count * n); for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { const p = o + k * st + c * sz; out[k * n + c] = ct === 5126 ? bin.readFloatLE(p) : ct === 5125 ? bin.readUInt32LE(p) : ct === 5123 ? bin.readUInt16LE(p) : bin.readUInt8(p); } return a.normalized ? out.map((v) => v / (ct === 5121 ? 255 : 65535)) : out; };
  const M = (n) => n.matrix ? new THREE.Matrix4().fromArray(n.matrix) : new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
  const prims = [];
  const walk = (i, parent) => {
    const n = j.nodes[i], m = parent.clone().multiply(M(n));
    if (n.mesh !== undefined) for (const p of j.meshes[n.mesh].primitives) {
      if (p.mode !== undefined && p.mode !== 4) continue;
      const P = acc(p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? acc(p.attributes.NORMAL) : null, U = p.attributes.TEXCOORD_0 !== undefined ? acc(p.attributes.TEXCOORD_0) : null;
      const I = p.indices !== undefined ? acc(p.indices) : Uint32Array.from({ length: P.length / 3 }, (_, k) => k);
      const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), nn = new THREE.Vector3();
      for (let k = 0; k < P.length; k += 3) { v.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(m); P[k] = v.x; P[k + 1] = v.y; P[k + 2] = v.z; if (N) { nn.set(N[k], N[k + 1], N[k + 2]).applyMatrix3(nm).normalize(); N[k] = nn.x; N[k + 1] = nn.y; N[k + 2] = nn.z; } }
      prims.push({ name: n.name, mat: p.material ?? -1, pos: P, nrm: N, uv: U, idx: I });
    }
    (n.children || []).forEach((c) => walk(c, m));
  };
  for (const s of j.scenes[0].nodes) walk(s, new THREE.Matrix4());
  const image = (idx) => { const im = j.images[idx], bv = j.bufferViews[im.bufferView]; return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); };
  return { j, prims, image };
}
