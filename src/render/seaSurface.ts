// PRO: the sea as real moving geometry. Three nested camera-centred grids (fine near, coarse far) displaced by the same waves the flight
// model uses (world/waves.ts), lit with proper normals, with depth-style colour, ripple texture, foam on crests and sun glitter.
import * as THREE from 'three';
import { WAVES, waveOmega, sea, surges, SURGE_SPEED } from '../world/waves';

const shaderWaves = () => WAVES.map((w, i) => `W[${i}] = vec4(${(w.dx / Math.hypot(w.dx, w.dy)).toFixed(4)}, ${(w.dy / Math.hypot(w.dx, w.dy)).toFixed(4)}, ${(Math.PI * 2 / w.L).toFixed(5)}, ${w.A.toFixed(3)}); O[${i}] = ${waveOmega(w.L).toFixed(5)};`).join('\n  ');

export class SeaSurface {
  readonly group = new THREE.Group();
  private meshes: { m: THREE.Mesh; cell: number }[] = [];
  private surgeU = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
  private floor: THREE.Mesh;
  private holeCs: { value: THREE.Vector2 }[] = [];
  private uniforms = { uTime: { value: 0 }, uAmp: { value: 1 }, uNight: { value: 0 }, uDetail: { value: null as THREE.Texture | null } };
  constructor(detail: THREE.Texture) {
    this.uniforms.uDetail.value = detail;
    this.group.name = 'sea';
    // the sea bed: seen only from under the surface (a dark sandy blue-green floor far below, so sinking never reveals a void)
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x06242e, fog: true }));
    this.floor.position.y = -58; this.floor.frustumCulled = false; this.group.add(this.floor);
    // [grid size m, segments, y offset]: the coarser rings sit a little lower so they never poke through the finer ones
    const rings: [number, number, number, number][] = [[900, 300, 0, 0], [7000, 240, -0.2, 440], [60000, 160, -0.4, 3400]];   // [size, segments, y offset, half-size of the hole left for the finer ring inside it]
    for (const [size, seg, dy, hole] of rings) {
      const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
      const hc = { value: new THREE.Vector2() }; this.holeCs.push(hc);
      const mat = this.material(size / seg, hole, hc);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 0; m.position.y = dy; m.receiveShadow = false;
      this.meshes.push({ m, cell: size / seg }); this.group.add(m);
    }
  }
  private material(cell: number, hole: number, hc: { value: THREE.Vector2 }) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a2740, roughness: 0.16, metalness: 0.0, envMapIntensity: 0.35, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.uniforms.uMinL = { value: cell * 4.2 }; sh.uniforms.uHole = { value: hole }; sh.uniforms.uHoleC = hc; sh.uniforms.uSurge = this.surgeU;   // waves shorter than ~4 cells would alias on this grid: skipped here
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uAmp; uniform float uMinL; uniform vec4 uSurge[4]; uniform vec4 uSurge2[4];
varying vec3 vSeaW; varying float vSeaH; varying float vSeaSteep;
vec4 W[${WAVES.length}]; float O[${WAVES.length}];
void seaInit() {
  ${shaderWaves()}
}
// returns (height, dh/dx, dh/dz) at three.js xz (x = east, z = -north)
vec3 seaWave(vec2 xz) {
  vec2 en = vec2(xz.x, -xz.y);
  float h = 0.0; vec2 g = vec2(0.0);
  for (int i = 0; i < ${WAVES.length}; i++) {
    float k = W[i].z, L = 6.28318 / k;
    float on = step(uMinL, L);
    float ph = k * dot(W[i].xy, en) - O[i] * uTime;
    h += on * W[i].w * sin(ph);
    float d = on * W[i].w * k * cos(ph);
    g += d * W[i].xy;
  }
  h *= uAmp; g *= uAmp;
  // impact surges: expanding rings of raised water (same formula as world/waves.ts surgeHeight)
  for (int i = 0; i < 4; i++) {
    vec4 S = uSurge[i];                       // (east, north, age, strength); strength 0 = unused
    if (S.w > 0.0 && S.z >= 0.0 && S.z < 40.0) {
      vec2 d = en - S.xy; float r = max(length(d), 0.001), a = S.z;
      float front = ${SURGE_SPEED.toFixed(1)} * a, w = 14.0 + 6.0 * a, x = (r - front) / w;
      float env = exp(-a / 12.0) / (1.0 + r / 60.0), ex = exp(-x * x);
      float ramp = smoothstep(0.0, 1.6, a);
      float ring = S.w * 14.0 * env * ex * (1.0 - 0.45 * x);
      float cen = S.w * 10.0 * exp(-a * 0.9) * exp(-(r * r) / (90.0 + 160.0 * a));
      h += ramp * (ring + cen);
      float dr = S.w * 14.0 * env * ex * (-2.0 * x / w * (1.0 - 0.45 * x) - 0.45 / w) + cen * (-2.0 * r / (90.0 + 160.0 * a));
      g += ramp * dr * d / r;
    }
  }
  return vec3(h, g.x, -g.y);
}`)
        .replace('#include <beginnormal_vertex>', `seaInit();
vec3 wv = seaWave((modelMatrix * vec4(position, 1.0)).xz);
vec3 objectNormal = normalize(vec3(-wv.y, 1.0, -wv.z));
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
transformed.y += wv.x;
vSeaH = wv.x; vSeaSteep = length(wv.yz);
vSeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uAmp; uniform float uNight; uniform sampler2D uDetail; uniform float uHole; uniform vec2 uHoleC;
varying vec3 vSeaW; varying float vSeaH; varying float vSeaSteep;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // ripple texture: two scrolling layers of fine normal detail on top of the geometric waves, fading with distance
  vec2 p = vSeaW.xz;
  float dd = length(vSeaW - cameraPosition);
  float near = 1.0 - smoothstep(60.0, 1800.0, dd);
  vec2 r1 = texture2D(uDetail, p / 13.0 + vec2(uTime * 0.04, uTime * 0.03)).rg - 0.5;
  vec2 r2 = texture2D(uDetail, p / 4.3 - vec2(uTime * 0.07, uTime * 0.05) + 0.37).ba - 0.5;
  vec3 wn = normalize(vec3((r1.x + 0.6 * r2.x) * 0.22 * near, 1.0, (r1.y + 0.6 * r2.y) * 0.22 * near));
  normal = normalize(normal + (viewMatrix * vec4(wn.x, 0.0, wn.z, 0.0)).xyz * 0.9);
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
if (uHole > 0.0 && abs(vSeaW.x - uHoleC.x) < uHole && abs(vSeaW.z - uHoleC.y) < uHole) discard;   // the finer grid covers this part
{
  float dd2 = length(vSeaW - cameraPosition);
  // body colour: deep blue-green, lighter and greener on the lit crests and where the slope faces the sky
  float crestH = clamp(vSeaH / (3.0 * uAmp + 0.01) * 0.5 + 0.5, 0.0, 1.0);
  vec3 deepC = vec3(0.006, 0.045, 0.12), crestC = vec3(0.02, 0.13, 0.19);
  diffuseColor.rgb = mix(deepC, crestC, crestH * crestH);
  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.03, 0.20, 0.28);   // seen from below: lit blue-green water
  // foam: whitecaps on the steepest, highest crests, broken up with noise
  float n = texture2D(uDetail, vSeaW.xz / 11.0 + uTime * 0.02).r * 0.6 + texture2D(uDetail, vSeaW.xz / 3.7 - uTime * 0.03).g * 0.4;
  float foam = smoothstep(0.78, 1.05, crestH * 0.5 + vSeaSteep * 0.9 + n * 0.3 - 0.12) * (1.0 - smoothstep(500.0, 5000.0, dd2));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.91, 0.95), foam * 0.85);
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // sky reflection: Fresnel, strongest at grazing angles; sky-blue, never a mirror
  vec3 Vn = normalize(vViewPosition);
  float fr = pow(1.0 - clamp(dot(normalize(normal), Vn), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += vec3(0.30, 0.52, 0.85) * (0.03 + 0.5 * fr) * (1.0 - uNight);
}`);
    };
    mat.customProgramCacheKey = () => 'sea-surface';
    return mat;
  }
  update(cam: THREE.Vector3, night: number) {
    this.uniforms.uTime.value = sea.t; this.uniforms.uAmp.value = sea.amp; this.uniforms.uNight.value = night;
    const U = this.surgeU.value;
    for (let i = 0; i < 4; i++) { const g = surges[i]; if (g) U[i].set(g.e, g.n, sea.t - g.t0, g.s); else U[i].set(0, 0, 0, 0); }
    this.floor.position.x = cam.x; this.floor.position.z = cam.z;
    this.meshes.forEach(({ m, cell }, i) => { m.position.x = Math.round(cam.x / cell) * cell; m.position.z = Math.round(cam.z / cell) * cell; if (i > 0) this.holeCs[i].value.set(this.meshes[i - 1].m.position.x, this.meshes[i - 1].m.position.z); });
  }
}
