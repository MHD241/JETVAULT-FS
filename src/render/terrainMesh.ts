// Chunked, level-of-detail terrain rendering for the two-level heightfield.
//
// Full-detail chunks are triangulated EXACTLY as world/terrain.ts samples the ground
// (NE-SW diagonal), so near the aircraft the drawn surface and the physics surface are
// the same triangles. Coarser LODs are used further away; skirts hide LOD cracks.

import * as THREE from 'three';
import { HeightGrid } from '../world/terrain';
import { LandCover } from '../world/world';

const HI_CHUNK = 64; // cells per chunk (hi grid: 1600 cells -> 25 x 25 chunks)
const LO_CHUNK = 40; // cells per chunk (lo grid: 1000 cells -> 25 x 25 chunks)

interface Chunk {
  grid: HeightGrid;
  r0: number; c0: number; cells: number;
  cx: number; cz: number; // three.js centre (east, -north)
  minY: number; maxY: number;
  lod: number;
  mesh: THREE.Mesh;
  geoms: Map<number, THREE.BufferGeometry>;
}

export interface TerrainOverlay {
  texture: THREE.Texture;
  /** west/south corner (east, north) and size in metres */
  e0: number; n0: number; size: number;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  /** Multiplier on LOD switch distances (graphics setting). */
  detail = 1;
  hiMaterial: THREE.MeshStandardMaterial;
  loMaterial: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
  trianglesDrawn = 0;

  constructor(
    hi: HeightGrid, lo: HeightGrid | null, lcHi: LandCover | null, lcLo: LandCover | null,
    overlay: TerrainOverlay | null,
  ) {
    const detailTex = makeNoiseTexture(256);
    this.uniforms = {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uDetail: { value: detailTex },
      uWet: { value: 0 },
    };
    this.hiMaterial = makeTerrainMaterial(this.uniforms, lcHi, overlay);
    this.loMaterial = makeTerrainMaterial(this.uniforms, lcLo, null);
    this.group.name = 'terrain';

    const nHi = (hi.n - 1) / HI_CHUNK;
    for (let i = 0; i < nHi; i++) for (let j = 0; j < nHi; j++) this.addChunk(hi, i * HI_CHUNK, j * HI_CHUNK, HI_CHUNK, this.hiMaterial);
    if (lo) {
      const nLo = (lo.n - 1) / LO_CHUNK;
      for (let i = 0; i < nLo; i++) for (let j = 0; j < nLo; j++) {
        // skip far-field chunks fully covered by the high resolution core
        const e0 = -lo.half + j * LO_CHUNK * lo.step, e1 = e0 + LO_CHUNK * lo.step;
        const n1 = lo.half - i * LO_CHUNK * lo.step, n0 = n1 - LO_CHUNK * lo.step;
        if (e0 >= -hi.half - 1 && e1 <= hi.half + 1 && n0 >= -hi.half - 1 && n1 <= hi.half + 1) continue;
        this.addChunk(lo, i * LO_CHUNK, j * LO_CHUNK, LO_CHUNK, this.loMaterial);
      }
    }
  }

  private addChunk(grid: HeightGrid, r0: number, c0: number, cells: number, mat: THREE.Material) {
    let minY = Infinity, maxY = -Infinity;
    for (let r = r0; r <= r0 + cells; r++) for (let c = c0; c <= c0 + cells; c++) {
      const h = grid.at(r, c);
      if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
    const cx = -grid.half + (c0 + cells / 2) * grid.step;
    const cz = -(grid.half - (r0 + cells / 2) * grid.step);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.group.add(mesh);
    this.chunks.push({ grid, r0, c0, cells, cx, cz, minY, maxY, lod: -1, mesh, geoms: new Map() });
  }

  /** Choose LODs for the camera position (three.js coords). */
  update(cam: THREE.Vector3, time: number) {
    this.uniforms.uTime.value = time;
    let tris = 0;
    for (const ch of this.chunks) {
      const half = (ch.cells * ch.grid.step) / 2;
      const dx = Math.max(0, Math.abs(cam.x - ch.cx) - half);
      const dz = Math.max(0, Math.abs(cam.z - ch.cz) - half);
      const dy = Math.max(0, cam.y - ch.maxY, ch.minY - cam.y);
      const d = Math.hypot(dx, dz, dy * 0.5) / this.detail;
      let lod: number;
      if (ch.grid.step < 100) lod = d < 2500 ? 1 : d < 6000 ? 2 : d < 12000 ? 4 : d < 24000 ? 8 : 16;
      else lod = d < 15000 ? 1 : d < 40000 ? 2 : 4;
      if (lod !== ch.lod) {
        let g = ch.geoms.get(lod);
        if (!g) { g = buildChunkGeometry(ch.grid, ch.r0, ch.c0, ch.cells, lod, ch.cx, ch.cz); ch.geoms.set(lod, g); }
        ch.mesh.geometry = g;
        ch.mesh.visible = true;
        ch.lod = lod;
        // free far-away detail
        for (const [k, gg] of ch.geoms) if (k < lod / 2) { gg.dispose(); ch.geoms.delete(k); }
      }
      const n = ch.cells / ch.lod;
      tris += n * n * 2;
    }
    this.trianglesDrawn = tris;
  }

  setNight(f: number) { this.uniforms.uNight.value = f; }
  setWet(f: number) { this.uniforms.uWet.value = f; }
}

function buildChunkGeometry(grid: HeightGrid, r0: number, c0: number, cells: number, stride: number, cx: number, cz: number) {
  const n = cells / stride + 1;
  const skirt = 4 * n; // perimeter vertices for skirts
  const pos = new Float32Array((n * n + skirt) * 3);
  const nor = new Float32Array((n * n + skirt) * 3);
  const s = grid.step;
  const ns = stride; // normal sampling distance in samples
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = r0 + i * stride, c = c0 + j * stride;
      const e = -grid.half + c * s, no = grid.half - r * s;
      pos[k * 3] = e - cx;
      pos[k * 3 + 1] = grid.at(r, c);
      pos[k * 3 + 2] = -no - cz;
      const hx = (grid.at(r, c + ns) - grid.at(r, c - ns)) / (2 * ns * s); // d/deast
      const hz = (grid.at(r + ns, c) - grid.at(r - ns, c)) / (2 * ns * s); // d/dsouth (= three +z)
      const l = Math.hypot(hx, 1, hz);
      nor[k * 3] = -hx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -hz / l;
      k++;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const nw = i * n + j, ne = nw + 1, sw = nw + n, se = sw + 1;
      idx.push(nw, sw, ne, ne, sw, se);
    }
  }
  // skirts: drop a curtain along each edge to hide cracks between LODs
  const depth = 6 + stride * 6;
  const edge: number[] = [];
  for (let j = 0; j < n; j++) edge.push(j); // north
  for (let i = 1; i < n; i++) edge.push(i * n + n - 1); // east
  for (let j = n - 2; j >= 0; j--) edge.push((n - 1) * n + j); // south
  for (let i = n - 2; i >= 1; i--) edge.push(i * n); // west
  const base = n * n;
  edge.forEach((v, m) => {
    const t = base + m;
    pos[t * 3] = pos[v * 3]; pos[t * 3 + 1] = pos[v * 3 + 1] - depth; pos[t * 3 + 2] = pos[v * 3 + 2];
    nor[t * 3] = nor[v * 3]; nor[t * 3 + 1] = nor[v * 3 + 1]; nor[t * 3 + 2] = nor[v * 3 + 2];
  });
  for (let m = 0; m < edge.length; m++) {
    const a = edge[m], b = edge[(m + 1) % edge.length];
    const a2 = base + m, b2 = base + ((m + 1) % edge.length);
    idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both windings
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Tileable value-noise fBm texture used for terrain detail and water ripples. */
export function makeNoiseTexture(size: number) {
  const data = new Uint8Array(size * size * 4);
  const rnd = (x: number, y: number, s: number) => {
    const h = Math.sin(((x % s) * 127.1 + (y % s) * 311.7 + s * 17.3)) * 43758.5453;
    return h - Math.floor(h);
  };
  const vnoise = (x: number, y: number, period: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = x - xi, ty = y - yi;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const p = period;
    const a = rnd((xi + p) % p, (yi + p) % p, p), b = rnd((xi + 1 + p) % p, (yi + p) % p, p);
    const c = rnd((xi + p) % p, (yi + 1 + p) % p, p), d = rnd((xi + 1 + p) % p, (yi + 1 + p) % p, p);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ch = [0, 0, 0, 0];
    for (let o = 0; o < 4; o++) {
      let v = 0, amp = 0.5, tot = 0;
      for (let oct = 0; oct < 5; oct++) {
        const per = 4 << (oct + o % 2);
        v += vnoise((x / size) * per + o * 13.7, (y / size) * per + o * 7.1, per) * amp;
        tot += amp; amp *= 0.5;
      }
      ch[o] = v / tot;
    }
    const i = (y * size + x) * 4;
    data[i] = ch[0] * 255; data[i + 1] = ch[1] * 255; data[i + 2] = ch[2] * 255; data[i + 3] = ch[3] * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function makeLandcoverTexture(lc: LandCover) {
  const t = new THREE.DataTexture(lc.data, lc.n, lc.n, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function makeTerrainMaterial(shared: Record<string, THREE.IUniform>, lc: LandCover | null, overlay: TerrainOverlay | null) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const empty = new THREE.DataTexture(new Uint8Array([30, 0, 0, 0]), 1, 1, THREE.RedFormat);
  empty.needsUpdate = true;
  const local = {
    uLc: { value: lc ? makeLandcoverTexture(lc) : empty },
    uLcN: { value: lc ? lc.n : 1 },
    uLcHalf: { value: lc ? lc.half : 1e9 },
    uLcStep: { value: lc ? lc.step : 1e9 },
    uOverlay: { value: overlay ? overlay.texture : null },
    uOverlayRect: { value: overlay ? new THREE.Vector3(overlay.e0, overlay.n0, overlay.size) : new THREE.Vector3(0, 0, -1) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, local);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform sampler2D uLc;
uniform float uLcN, uLcHalf, uLcStep, uTime, uNight, uWet;
uniform sampler2D uDetail;
uniform sampler2D uOverlay;
uniform vec3 uOverlayRect;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
// ESA WorldCover class -> albedo, with per-field variation for cropland
vec3 classColor(float cls, vec2 en, float n1) {
  if (cls < 15.0) return srgb(vec3(0.16, 0.22, 0.12)) * (0.75 + 0.5 * n1);             // tree cover
  if (cls < 25.0) return srgb(vec3(0.33, 0.33, 0.21)) * (0.8 + 0.4 * n1);              // shrubland
  if (cls < 35.0) return srgb(vec3(0.34, 0.44, 0.20)) * (0.85 + 0.3 * n1);             // grassland / pasture
  if (cls < 45.0) {                                                                    // cropland: patchwork of fields
    vec2 w = en + 60.0 * vec2(texture2D(uDetail, en / 2300.0).r, texture2D(uDetail, en / 2300.0 + 0.5).g);
    float h = hash12(floor(w / 190.0));
    vec3 c = h < 0.35 ? vec3(0.40, 0.48, 0.22) : h < 0.6 ? vec3(0.62, 0.57, 0.36) : h < 0.8 ? vec3(0.46, 0.38, 0.26) : vec3(0.52, 0.55, 0.30);
    return srgb(c) * (0.9 + 0.2 * n1);
  }
  if (cls < 55.0) {                                                                    // built-up: roofs, streets, gardens
    float a = texture2D(uDetail, en / 61.0).b, b = texture2D(uDetail, en / 23.0).a;
    vec3 c = mix(vec3(0.33, 0.32, 0.31), vec3(0.36, 0.29, 0.25), smoothstep(0.45, 0.65, a));
    c = mix(c, vec3(0.27, 0.33, 0.21), smoothstep(0.55, 0.75, b) * 0.6);                // gardens and street trees
    return srgb(c) * (0.85 + 0.3 * n1);
  }
  if (cls < 65.0) return srgb(vec3(0.50, 0.46, 0.40)) * (0.85 + 0.3 * n1);             // bare
  if (cls < 75.0) return srgb(vec3(0.90, 0.92, 0.95));                                 // snow
  if (cls < 85.0) return srgb(vec3(0.05, 0.09, 0.11));                                 // water
  if (cls < 92.0) return srgb(vec3(0.30, 0.34, 0.22)) * (0.85 + 0.3 * n1);             // wetland
  return srgb(vec3(0.38, 0.31, 0.26)) * (0.85 + 0.3 * n1);                             // moss / heather
}
float lcAt(ivec2 p) { p = clamp(p, ivec2(0), ivec2(int(uLcN) - 1)); return texelFetch(uLc, p, 0).r * 255.0; }
float gWater; float gBuilt; float gPaved;
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 en = vec2(vWorldPos.x, -vWorldPos.z);
  float n1 = texture2D(uDetail, en / 97.0).r;
  float n2 = texture2D(uDetail, en / 11.0).g;
  vec2 warp = (vec2(texture2D(uDetail, en / 410.0).b, texture2D(uDetail, en / 410.0 + 0.37).a) - 0.5) * 0.9;
  vec2 f = vec2((en.x + uLcHalf) / uLcStep, (uLcHalf - en.y) / uLcStep) + warp;
  vec2 i0 = floor(f); vec2 t = fract(f);
  float c00 = lcAt(ivec2(i0)), c10 = lcAt(ivec2(i0) + ivec2(1, 0)), c01 = lcAt(ivec2(i0) + ivec2(0, 1)), c11 = lcAt(ivec2(i0) + ivec2(1, 1));
  vec3 col = mix(mix(classColor(c00, en, n1), classColor(c10, en, n1), t.x), mix(classColor(c01, en, n1), classColor(c11, en, n1), t.x), t.y);
  float w00 = c00 > 75.0 && c00 < 85.0 ? 1.0 : 0.0, w10 = c10 > 75.0 && c10 < 85.0 ? 1.0 : 0.0;
  float w01 = c01 > 75.0 && c01 < 85.0 ? 1.0 : 0.0, w11 = c11 > 75.0 && c11 < 85.0 ? 1.0 : 0.0;
  gWater = smoothstep(0.35, 0.65, mix(mix(w00, w10, t.x), mix(w01, w11, t.x), t.y));
  float b00 = c00 > 45.0 && c00 < 55.0 ? 1.0 : 0.0, b10 = c10 > 45.0 && c10 < 55.0 ? 1.0 : 0.0;
  float b01 = c01 > 45.0 && c01 < 55.0 ? 1.0 : 0.0, b11 = c11 > 45.0 && c11 < 55.0 ? 1.0 : 0.0;
  gBuilt = mix(mix(b00, b10, t.x), mix(b01, b11, t.x), t.y);
  // steep slopes show rock and scree
  float slope = 1.0 - clamp(vWorldNormal.y, 0.0, 1.0);
  col = mix(col, srgb(vec3(0.42, 0.40, 0.37)) * (0.8 + 0.4 * n2), smoothstep(0.25, 0.45, slope) * (1.0 - gWater));
  col *= 0.88 + 0.24 * n2;
  // airport pavement overlay (taxiways / aprons) drawn from OSM geometry
  gPaved = 0.0;
  if (uOverlayRect.z > 0.0) {
    vec2 uv = (en - uOverlayRect.xy) / uOverlayRect.z;
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
      vec4 ov = texture2D(uOverlay, uv);
      gPaved = ov.a;
      col = mix(col, srgb(ov.rgb) * (0.92 + 0.16 * n2), ov.a);
    }
  }
  col = mix(col, col * 0.55, uWet * (1.0 - gWater) * gPaved);
  diffuseColor.rgb = mix(col, srgb(vec3(0.05, 0.09, 0.11)), gWater * (1.0 - gPaved));
}
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.08, gWater * (1.0 - gPaved));
roughnessFactor = mix(roughnessFactor, mix(0.85, 0.35, uWet), gPaved);
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (gWater > 0.01) {
  vec2 en2 = vec2(vWorldPos.x, -vWorldPos.z);
  vec2 r1 = texture2D(uDetail, en2 / 31.0 + vec2(uTime * 0.011, uTime * 0.007)).rg - 0.5;
  vec2 r2 = texture2D(uDetail, en2 / 7.0 - vec2(uTime * 0.02, uTime * 0.013)).ba - 0.5;
  vec3 wn = normalize(vec3((r1.x + 0.5 * r2.x) * 0.18, 1.0, (r1.y + 0.5 * r2.y) * 0.18));
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), gWater));
}
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uNight > 0.01) {
  vec2 en3 = vec2(vWorldPos.x, -vWorldPos.z);
  float sp = hash12(floor(en3 / 9.0));
  float street = step(0.86, sp) * gBuilt;
  totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * street * uNight * 0.9;
}
`);
  };
  mat.customProgramCacheKey = () => (overlay ? 'terrain-ov' : 'terrain');
  return mat;
}
