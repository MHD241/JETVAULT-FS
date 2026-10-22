// Buildings rendered from exactly the same extruded footprints used for collision
// (world/obstacles.ts). Merged per 2 km tile to keep draw calls low.

import * as THREE from 'three';
import { Building } from '../world/obstacles';

const TILE = 2000;

export class BuildingsRenderer {
  readonly group = new THREE.Group();
  private tiles: { mesh: THREE.Mesh; cx: number; cz: number }[] = [];
  private uniforms = { uNight: { value: 0 } };
  maxDistance = 14000;
  triangles = 0;

  constructor(buildings: Building[]) {
    this.group.name = 'buildings';
    const byTile = new Map<string, Building[]>();
    for (const b of buildings) {
      const key = `${Math.floor((b.minE + b.maxE) / 2 / TILE)},${Math.floor((b.minN + b.maxN) / 2 / TILE)}`;
      let l = byTile.get(key);
      if (!l) { l = []; byTile.set(key, l); }
      l.push(b);
    }
    const mat = this.material();
    for (const [key, list] of byTile) {
      const [tx, ty] = key.split(',').map(Number);
      const cx = (tx + 0.5) * TILE, cn = (ty + 0.5) * TILE;
      const g = buildTileGeometry(list, cx, cn);
      this.triangles += g.index!.count / 3;
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(cx, 0, -cn);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.tiles.push({ mesh, cx, cz: -cn });
    }
  }

  private material() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.uniforms.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 wallUv;\nvarying vec3 vWall;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = wallUv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWall;
uniform float uNight;
float bh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float gWin;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
gWin = 0.0;
if (vWall.z > 1.5) {
  // glazed facade: continuous ribbon glazing with mullions, 4.5 m storeys
  vec2 cell = vec2(vWall.x / 1.8, vWall.y / 4.5);
  vec2 f = fract(cell);
  float win = step(0.06, f.x) * step(f.x, 0.96) * step(0.12, f.y) * step(f.y, 0.86) * step(1.0, vWall.y);
  gWin = win * 0.9;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.17, 0.24), win * 0.85);
} else if (vWall.z > 0.5) {
  // windows: 3.2 m storeys, ~2.6 m bays
  vec2 cell = vec2(vWall.x / 2.6, vWall.y / 3.2);
  vec2 f = fract(cell);
  float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.78) * step(1.0, vWall.y);
  gWin = win * step(0.45, bh(floor(cell) + floor(vWall.x / 97.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.07), win * 0.85);
}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, gWin);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * gWin * uNight * 0.8;');
    };
    return mat;
  }

  update(cam: THREE.Vector3, night: number) {
    this.uniforms.uNight.value = night;
    for (const t of this.tiles) {
      t.mesh.visible = Math.hypot(cam.x - t.cx, cam.z - t.cz) < this.maxDistance + TILE;
    }
  }
}

const PALETTE = [
  [0.62, 0.55, 0.45], [0.56, 0.49, 0.40], [0.70, 0.66, 0.58], [0.50, 0.50, 0.50],
  [0.66, 0.63, 0.60], [0.45, 0.38, 0.33], [0.75, 0.74, 0.72],
].map((c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));
const ROOFS = [[0.30, 0.31, 0.33], [0.36, 0.34, 0.33], [0.42, 0.25, 0.20], [0.25, 0.26, 0.27]]
  .map((c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));

const GLASS = new THREE.Color().setRGB(0.42, 0.52, 0.60, THREE.SRGBColorSpace);
const CLAD = new THREE.Color().setRGB(0.62, 0.66, 0.70, THREE.SRGBColorSpace);
const TERM_ROOF = new THREE.Color().setRGB(0.70, 0.71, 0.72, THREE.SRGBColorSpace);

function buildTileGeometry(list: Building[], cx: number, cn: number) {
  const pos: number[] = [], col: number[] = [], wuv: number[] = [], idx: number[] = [];
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const b of list) {
    const n = b.pts.length / 2;
    let wall = PALETTE[Math.floor(rnd() * PALETTE.length)];
    let roof = ROOFS[Math.floor(rnd() * ROOFS.length)];
    let tall = b.top - b.base > 6 ? 1 : 0;
    if (b.role === 'terminal' || b.role === 'pier') { wall = GLASS; roof = TERM_ROOF; tall = 2; }
    else if (b.role === 'airside') { wall = CLAD; roof = TERM_ROOF; tall = 0; }
    let perim = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = b.pts[2 * i] - cx, y0 = b.pts[2 * i + 1] - cn;
      const x1 = b.pts[2 * j] - cx, y1 = b.pts[2 * j + 1] - cn;
      const L = Math.hypot(x1 - x0, y1 - y0);
      const v = pos.length / 3;
      // CCW footprint: outward face winding as seen from outside
      pos.push(x0, b.base, -y0, x1, b.base, -y1, x1, b.top, -y1, x0, b.top, -y0);
      const h = b.top - b.base;
      wuv.push(perim, 0, tall, perim + L, 0, tall, perim + L, h, tall, perim, h, tall);
      for (let k = 0; k < 4; k++) col.push(wall.r, wall.g, wall.b);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      perim += L;
    }
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b.pts[2 * i] - cx, b.pts[2 * i + 1] - cn));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const v0 = pos.length / 3;
    for (const p of contour) { pos.push(p.x, b.top, -p.y); col.push(roof.r, roof.g, roof.b); wuv.push(0, 0, 0); }
    for (const t of tris) idx.push(v0 + t[0], v0 + t[1], v0 + t[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wallUv', new THREE.Float32BufferAttribute(wuv, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
