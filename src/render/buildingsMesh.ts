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
    // thinned out: every large building stays, only one in three of the small ones
    buildings = buildings.filter((b, i) => (b.maxE - b.minE) * (b.maxN - b.minN) > 900 || i % 3 === 0);
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
float fwd = length(fwidth(vWall.xy));
float fine = 1.0 - smoothstep(0.12, 0.45, fwd);                 // fine detail (brick courses, stone joints) fades out with distance so it never shimmers
if (vWall.z > 4.5) {
  // concrete panels: 3 m panels with seams, a continuous ribbon window on every 3.4 m storey
  vec2 cell = vec2(vWall.x / 3.0, vWall.y / 3.4);
  vec2 f = fract(cell);
  float seam = (1.0 - smoothstep(0.0, 0.025, f.x)) * fine;
  float win = step(0.30, f.y) * step(f.y, 0.78) * step(1.0, vWall.y) * step(0.04, f.x) * step(f.x, 0.96);
  diffuseColor.rgb *= 1.0 - 0.18 * seam - 0.05 * bh(floor(cell));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.16, 0.19), win * 0.85);
  gWin = win * 0.7;
} else if (vWall.z > 3.5) {
  // sandstone / granite: ashlar blocks 1.0 x 0.5 m with per-block tone, tall sash windows with pale surrounds
  vec2 bc = vec2(vWall.x / 1.0 + 0.5 * mod(floor(vWall.y / 0.5), 2.0), vWall.y / 0.5);
  vec2 bf = fract(bc);
  float joint = (1.0 - step(0.04, bf.x) * step(0.06, bf.y)) * fine;
  diffuseColor.rgb *= (0.9 + 0.2 * bh(floor(bc))) * (1.0 - 0.22 * joint);
  vec2 cell = vec2(vWall.x / 3.2, vWall.y / 3.8);
  vec2 f = fract(cell);
  float surround = step(0.22, f.x) * step(f.x, 0.78) * step(0.2, f.y) * step(f.y, 0.88) * step(1.0, vWall.y);
  float win = step(0.30, f.x) * step(f.x, 0.70) * step(0.26, f.y) * step(f.y, 0.84) * step(1.0, vWall.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12, surround * (1.0 - win));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.07, 0.08), win * 0.9);
  gWin = win * step(0.5, bh(floor(cell) + 3.0));
} else if (vWall.z > 2.5) {
  // red brick: 0.5 x 0.14 m coursing with mortar, 3 m storeys with 1.3 m windows and pale lintels
  vec2 bc = vec2(vWall.x / 0.5 + 0.5 * mod(floor(vWall.y / 0.14), 2.0), vWall.y / 0.14);
  vec2 bf = fract(bc);
  float mortar = (1.0 - step(0.06, bf.x) * step(0.14, bf.y)) * fine;
  diffuseColor.rgb *= (0.86 + 0.28 * bh(floor(bc))) ;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.62, 0.55), mortar * 0.8);
  vec2 cell = vec2(vWall.x / 2.4, vWall.y / 3.0);
  vec2 f = fract(cell);
  float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.30, f.y) * step(f.y, 0.80) * step(1.0, vWall.y);
  float lintel = step(0.28, f.x) * step(f.x, 0.72) * step(0.80, f.y) * step(f.y, 0.86) * step(1.0, vWall.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.72, 0.66), lintel);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.07), win * 0.9);
  gWin = win * step(0.4, bh(floor(cell) + 9.0));
} else if (vWall.z > 1.5) {
  // glazed facade: continuous ribbon glazing with mullions, 4.5 m storeys
  vec2 cell = vec2(vWall.x / 1.8, vWall.y / 4.5);
  vec2 f = fract(cell);
  float win = step(0.06, f.x) * step(f.x, 0.96) * step(0.12, f.y) * step(f.y, 0.86) * step(1.0, vWall.y);
  gWin = win * 0.9;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.17, 0.24), win * 0.85);
  diffuseColor.rgb += 0.10 * (bh(floor(cell)) - 0.5) * win;       // slight per-pane reflection variation
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

  /** Frees all tile geometries (the patch was unloaded). */
  dispose() {
    for (const t of this.tiles) t.mesh.geometry.dispose();
    this.group.removeFromParent();
  }

  update(cam: THREE.Vector3, night: number) {
    this.uniforms.uNight.value = night;
    for (const t of this.tiles) {
      t.mesh.visible = Math.hypot(cam.x - t.cx, cam.z - t.cz) < this.maxDistance + TILE;
    }
  }
}

const PALETTE = [
  [0.62, 0.55, 0.45], [0.56, 0.49, 0.40], [0.70, 0.66, 0.58], [0.50, 0.50, 0.50], [0.66, 0.63, 0.60], [0.45, 0.38, 0.33], [0.75, 0.74, 0.72],
  [0.58, 0.42, 0.33], [0.64, 0.50, 0.38], [0.80, 0.77, 0.70], [0.42, 0.40, 0.38], [0.54, 0.36, 0.30], [0.72, 0.64, 0.52], [0.36, 0.34, 0.33],
].map((c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));
const ROOFS = [[0.30, 0.31, 0.33], [0.36, 0.34, 0.33], [0.42, 0.25, 0.20], [0.25, 0.26, 0.27], [0.18, 0.19, 0.21], [0.48, 0.30, 0.24], [0.33, 0.30, 0.27]]
  .map((c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));

const mk = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const STYLE_COLORS: Record<number, THREE.Color[]> = {
  2: [mk(0.38, 0.52, 0.62), mk(0.30, 0.44, 0.52), mk(0.42, 0.48, 0.55), mk(0.34, 0.50, 0.50), mk(0.50, 0.46, 0.38)],     // glass: blue, teal, grey, bronze tints
  3: [mk(0.55, 0.26, 0.19), mk(0.62, 0.32, 0.22), mk(0.48, 0.22, 0.17), mk(0.66, 0.40, 0.28), mk(0.42, 0.25, 0.20)],     // red / brown brick
  4: [mk(0.76, 0.64, 0.46), mk(0.70, 0.60, 0.46), mk(0.62, 0.55, 0.45), mk(0.52, 0.52, 0.52), mk(0.74, 0.68, 0.56)],     // sandstone and granite
  5: [mk(0.70, 0.70, 0.68), mk(0.58, 0.58, 0.57), mk(0.78, 0.76, 0.72), mk(0.46, 0.47, 0.48)],                           // concrete
};
const STYLE_ROOFS = [mk(0.30, 0.31, 0.33), mk(0.24, 0.25, 0.27), mk(0.40, 0.24, 0.19), mk(0.18, 0.19, 0.21), mk(0.52, 0.52, 0.50)];
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
    if (b.style) { const pal = STYLE_COLORS[b.style]; wall = pal[Math.floor(rnd() * pal.length)]; roof = STYLE_ROOFS[Math.floor(rnd() * STYLE_ROOFS.length)]; tall = b.style; }
    else if (b.role === 'terminal' || b.role === 'pier') { wall = GLASS; roof = TERM_ROOF; tall = 2; }
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
