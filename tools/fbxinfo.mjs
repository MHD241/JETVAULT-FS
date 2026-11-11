import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
globalThis.self = globalThis; globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(v) {} }) };
const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = new FBXLoader().parse(ab, '');
root.updateMatrixWorld(true);
let meshes = 0, tris = 0; const mats = new Set(); const top = [];
const bb = new THREE.Box3().setFromObject(root);
root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; [].concat(o.material).forEach((m) => mats.add(m.name + '|' + (m.map?.name || m.map?.image?.src || ''))); } });
for (const c of root.children) { const b = new THREE.Box3().setFromObject(c); const s = b.getSize(new THREE.Vector3()); let t = 0, mm = 0; c.traverse((o) => { if (o.isMesh) { mm++; t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } }); top.push(`${c.name}: ${mm} meshes ${t} tris size ${s.x.toFixed(0)}x${s.y.toFixed(0)}x${s.z.toFixed(0)}`); }
console.log('meshes', meshes, 'tris', tris, 'top-level', root.children.length);
console.log('bbox', bb.min.toArray().map((v) => v.toFixed(0)), bb.max.toArray().map((v) => v.toFixed(0)));
console.log([...mats].slice(0, 30).join('\n'));
console.log(top.slice(0, 40).join('\n'));
