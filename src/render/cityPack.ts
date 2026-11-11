// PRO: the two big towers of the 3DTGRL "City Buildings" pack (CGTrader, free) as prototypes (tools/citybldg.mjs ->
// public/models/citypack/bldg.json/.bin), duplicated as instances around central Edinburgh. One InstancedMesh per prototype material.
import * as THREE from 'three';
import type { World } from '../world/world';
import { LC } from '../world/world';
import { LocalProjection, EGPH_ORIGIN } from '../world/geo';
import { EDINBURGH_CENTRE } from '../world/city';

const hash = (a: number, b: number, s = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 144665231);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export interface TowerSpot { e: number; n: number; proto: number; yaw: number; scale: number }

/** Deterministic tower sites (also used by the generated city to leave those cells free). */
export function towerSpots(world: World, radius = 3600, cell = 58): TowerSpot[] {
  const proj = new LocalProjection(EGPH_ORIGIN.lat, EGPH_ORIGIN.lon);
  const c = proj.forward(EDINBURGH_CENTRE.lat, EDINBURGH_CENTRE.lon);
  const yaw = (20 * Math.PI) / 180, cy = Math.cos(yaw), sy = Math.sin(yaw), n = Math.ceil(radius / cell), out: TowerSpot[] = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const ox = i * cell, oy = j * cell, d = Math.hypot(ox, oy);
    if (d > radius || hash(i, j, 31) > 0.0034 * (d < 1800 ? 1.6 : 1)) continue;
    const e = c.east + ox * cy - oy * sy, nn = c.north + ox * sy + oy * cy;
    if (Math.hypot(e, nn) < 3200 || world.landAt(e, nn) !== LC.BUILT || world.heightAt(e, nn) < 1.5) continue;
    const proto = hash(i, j, 32) < 0.35 ? 0 : 1;
    out.push({ e, n: nn, proto, yaw: yaw + Math.floor(hash(i, j, 33) * 4) * Math.PI / 2, scale: proto === 0 ? 0.30 + 0.12 * hash(i, j, 34) : 0.42 + 0.22 * hash(i, j, 34) });
  }
  return out;
}

interface MatMeta { name: string; map: string; color: number; n: number; ni: number; pos: number; nrm: number; uv: number; idx: number }

export async function loadCityPack(world: World, base = './models/citypack/'): Promise<THREE.Group> {
  const [meta, bin] = await Promise.all([fetch(base + 'bldg.json').then((r) => r.json()), fetch(base + 'bldg.bin').then((r) => r.arrayBuffer())]);
  const group = new THREE.Group(); group.name = 'citypack';
  const tl = new THREE.TextureLoader(); const texs = new Map<string, THREE.Texture>();
  const tex = (n: string) => { let t = texs.get(n); if (!t) { t = tl.load(base + n + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texs.set(n, t); } return t; };
  const spots = towerSpots(world);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  (meta as { size: number[]; mats: MatMeta[] }[]).forEach((proto, pi) => {
    const mine = spots.filter((t) => t.proto === pi);
    if (!mine.length) return;
    for (const m of proto.mats) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, m.pos, m.n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, m.nrm, m.n * 3), 3, true));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, m.uv, m.n * 2), 2));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, m.idx, m.ni), 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, proto.size[1] / 2, 0), Math.hypot(proto.size[0], proto.size[1], proto.size[2]) / 2);
      const mat = new THREE.MeshStandardMaterial({ map: m.map ? tex(m.map) : null, color: m.map ? 0xffffff : m.color, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
      const im = new THREE.InstancedMesh(g, mat, mine.length);
      mine.forEach((t, k) => {
        const h = world.heightAt(t.e, t.n);
        p.set(t.e, h - 2, -t.n); q.setFromAxisAngle(up, -t.yaw); s.setScalar(t.scale);
        im.setMatrixAt(k, m4.compose(p, q, s));
      });
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
      group.add(im);
    }
  });
  return group;
}
