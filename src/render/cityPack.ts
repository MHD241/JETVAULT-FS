// PRO: the 3DTGRL "City Buildings" pack (CGTrader, free), converted by tools/citypack.mjs to public/models/citypack (about 135k triangles,
// 22 materials = 22 draw calls). Placed in central Edinburgh on a rotated grid. TEMPORARY test: see PROJECT_STATE for lag checks.
import * as THREE from 'three';
import type { World } from '../world/world';
import { LocalProjection, EGPH_ORIGIN } from '../world/geo';
import { EDINBURGH_CENTRE } from '../world/city';

interface Mat { name: string; map: string; color: number; opacity: number; n: number; ni: number; pos: number; nrm: number; uv: number; idx: number }

export async function loadCityPack(world: World, base = './models/citypack/'): Promise<THREE.Group> {
  const [meta, bin] = await Promise.all([fetch(base + 'pack.json').then((r) => r.json()), fetch(base + 'pack.bin').then((r) => r.arrayBuffer())]);
  const group = new THREE.Group(); group.name = 'citypack';
  const tl = new THREE.TextureLoader(); const texs = new Map<string, THREE.Texture>();
  const tex = (n: string) => { let t = texs.get(n); if (!t) { t = tl.load(base + n + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texs.set(n, t); } return t; };
  for (const m of meta.materials as Mat[]) {
    if (/Washingtonia/.test(m.map)) continue;   // palm cut-out textures need alpha; skipped for now
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, m.pos, m.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, m.nrm, m.n * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, m.uv, m.n * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, m.idx, m.ni), 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map: m.map ? tex(m.map) : null, color: m.map ? 0xffffff : m.color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = true;
    group.add(mesh);
  }
  const proj = new LocalProjection(EGPH_ORIGIN.lat, EGPH_ORIGIN.lon);
  const c = proj.forward(EDINBURGH_CENTRE.lat, EDINBURGH_CENTRE.lon);
  // lowest terrain under the pack's footprint: sit the pack on it so streets never sink below the ground
  const [sx, , sz] = meta.size as number[];
  let hMax = -1e9;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) hMax = Math.max(hMax, world.heightAt(c.east + i * sx / 4, c.north + j * sz / 4));
  group.position.set(c.east, hMax + 0.3, -c.north);
  group.rotation.y = -(20 * Math.PI) / 180;
  return group;
}
