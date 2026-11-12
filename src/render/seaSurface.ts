// PRO: the ocean. Three nested camera-centred grids of real geometry displaced by 48 spectrum Gerstner waves (the same waves the flight model
// uses, world/waves.ts) with choppy horizontal motion, analytic normals, foam from where the surface folds (Jacobian) and at shores, water
// colour from the distance to land (shallow turquoise -> deep navy), physical Fresnel reflection of the sky (PBR), sun glitter from the
// wave normals, and a proper underwater view: Snell's window, blue-green murk, marine snow, a sea bed.
import * as THREE from 'three';
import type { World } from '../world/world';
import { LC } from '../world/world';
import { CASCADES, sea, surges, SURGE_SPEED } from '../world/waves';

const [CA, CB] = CASCADES;
const NMAX = 24;
const DEPTH_N = 160, DEPTH_SIZE = 6000;

export class SeaSurface {
  readonly group = new THREE.Group();
  private meshes: { m: THREE.Mesh; cell: number }[] = [];
  private holeCs: { value: THREE.Vector2 }[] = [];
  private surgeU = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
  private rtA!: THREE.WebGLRenderTarget; private rtB!: THREE.WebGLRenderTarget;
  private simScene = new THREE.Scene(); private simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private simMatA!: THREE.RawShaderMaterial; private simMatB!: THREE.RawShaderMaterial; private simMesh!: THREE.Mesh;
  private depthTex: THREE.DataTexture; private depthData = new Uint8Array(DEPTH_N * DEPTH_N);
  private depthC = { value: new THREE.Vector2(1e9, 1e9) };
  private floor: THREE.Mesh;
  private snow: THREE.Points; private snowBase: Float32Array;
  private uniforms = { uTime: { value: 0 }, uAmp: { value: 1 }, uNight: { value: 0 }, uDetail: { value: null as THREE.Texture | null }, uUnder: { value: 0 } };
  private depthCam = new THREE.Vector2(1e9, 1e9);
  under = false;
  constructor(detail: THREE.Texture, private world: World, private renderer: THREE.WebGLRenderer) {
    this.initSim();
    this.uniforms.uDetail.value = detail;
    this.group.name = 'sea';
    this.depthTex = new THREE.DataTexture(this.depthData, DEPTH_N, DEPTH_N, THREE.RedFormat, THREE.UnsignedByteType);
    this.depthTex.minFilter = this.depthTex.magFilter = THREE.LinearFilter; this.depthTex.wrapS = this.depthTex.wrapT = THREE.ClampToEdgeWrapping;
    this.depthTex.needsUpdate = true;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x07303a, fog: true }));
    this.floor.position.y = -58; this.floor.frustumCulled = false; this.group.add(this.floor);
    // [size, segments, y offset, half-size of the hole left for the finer ring inside]
    const rings: [number, number, number, number][] = [[1400, 200, 0, 0], [9000, 128, -0.2, 680], [60000, 80, -0.4, 4400]];
    for (const [size, seg, dy, hole] of rings) {
      const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
      const hc = { value: new THREE.Vector2() }; this.holeCs.push(hc);
      const m = new THREE.Mesh(g, this.material(size / seg, hole, hc)); m.frustumCulled = false; m.position.y = dy; m.receiveShadow = false;
      this.meshes.push({ m, cell: size / seg }); this.group.add(m);
    }
    // marine snow: drifting specks around the camera, only visible underwater
    const SN = 300; this.snowBase = new Float32Array(SN * 3);
    for (let i = 0; i < SN * 3; i++) this.snowBase[i] = Math.random();
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 3), 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfe6e0, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    this.snow.frustumCulled = false; this.snow.visible = false; this.group.add(this.snow);
  }

  private initSim() {
    const mk = (res: number) => new THREE.WebGLRenderTarget(res, res, { count: 3, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true, depthBuffer: false });
    this.rtA = mk(CA.res); this.rtB = mk(CB.res);
    for (const rt of [this.rtA, this.rtB]) for (const t of rt.textures) { t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; }
    const frag = `precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
uniform float uTime; uniform float uT; uniform int uCount; uniform vec4 uWa[${NMAX}]; uniform vec4 uWb[${NMAX}];
void main() {
  vec2 en = vUv * uT;
  float h = 0.0, vert = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0; vec2 disp = vec2(0.0), slope = vec2(0.0);
  for (int i = 0; i < ${NMAX}; i++) {
    if (i >= uCount) break;
    vec4 a = uWa[i], b = uWb[i];
    float ph = a.z * dot(a.xy, en) - b.x * uTime + b.y;
    float s = sin(ph), c = cos(ph), kA = a.z * a.w, QA = b.z * a.w;
    h += a.w * s; disp += a.xy * (QA * c); slope += a.xy * (kA * c); vert += b.z * kA * s;
    jxx += b.z * kA * a.x * a.x * s; jzz += b.z * kA * a.y * a.y * s; jxz += b.z * kA * a.x * a.y * s;
  }
  o0 = vec4(h, disp, 0.0); o1 = vec4(slope, vert, 0.0); o2 = vec4(jxx, jzz, jxz, 0.0);
}`;
    const vert = `in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    const mat = (c: typeof CA) => {
      const wa = Array.from({ length: NMAX }, (_, i) => (c.waves[i] ? new THREE.Vector4(c.waves[i].dx, c.waves[i].dy, c.waves[i].k, c.waves[i].A) : new THREE.Vector4()));
      const wb = Array.from({ length: NMAX }, (_, i) => (c.waves[i] ? new THREE.Vector4(c.waves[i].w, c.waves[i].phi, c.waves[i].Q, c.waves[i].L) : new THREE.Vector4()));
      return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms: { uTime: { value: 0 }, uT: { value: c.T }, uCount: { value: c.waves.length }, uWa: { value: wa }, uWb: { value: wb } } });
    };
    this.simMatA = mat(CA); this.simMatB = mat(CB);
    this.simMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMatA); this.simMesh.frustumCulled = false; this.simScene.add(this.simMesh);
  }
  private runSim() {
    const r = this.renderer, prev = r.getRenderTarget();
    const old = { ac: r.autoClear };
    r.autoClear = false;
    this.simMatA.uniforms.uTime.value = sea.t; this.simMatB.uniforms.uTime.value = sea.t;
    this.simMesh.material = this.simMatA; r.setRenderTarget(this.rtA); r.render(this.simScene, this.simCam);
    this.simMesh.material = this.simMatB; r.setRenderTarget(this.rtB); r.render(this.simScene, this.simCam);
    r.setRenderTarget(prev); r.autoClear = old.ac;
  }

  private material(cell: number, hole: number, hc: { value: THREE.Vector2 }) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a2740, roughness: 0.07, metalness: 0.0, envMapIntensity: 0.2, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.uniforms.uHole = { value: hole }; sh.uniforms.uHoleC = hc; sh.uniforms.uSurge = this.surgeU;
      sh.uniforms.uCell = { value: cell }; sh.uniforms.uTA0 = { value: this.rtA.textures[0] }; sh.uniforms.uTA1 = { value: this.rtA.textures[1] }; sh.uniforms.uTA2 = { value: this.rtA.textures[2] }; sh.uniforms.uTB0 = { value: this.rtB.textures[0] }; sh.uniforms.uTB1 = { value: this.rtB.textures[1] }; sh.uniforms.uTB2 = { value: this.rtB.textures[2] }; sh.uniforms.uDepth = { value: this.depthTex }; sh.uniforms.uDepthC = this.depthC;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uAmp; uniform float uCell; uniform vec4 uSurge[4];
uniform sampler2D uTA0; uniform sampler2D uTB0;
varying vec3 vSeaW; varying float vSeaH; varying vec2 vSurgeG;
// the waves are computed once per frame into two repeating tiles (A 1024 m, B 128 m); a vertex just reads them, with a mip level matched to its grid cell
// so waves smaller than the cell are averaged away instead of aliasing. x = height, yz = choppy displacement (east, north).
vec3 seaTex(vec2 en) {
  float lodA = max(0.0, log2(uCell / ${(CA.T / CA.res).toFixed(3)})), lodB = max(0.0, log2(uCell / ${(CB.T / CB.res).toFixed(3)}));
  return (textureLod(uTA0, en / ${CA.T.toFixed(1)}, lodA).xyz + textureLod(uTB0, en / ${CB.T.toFixed(1)}, lodB).xyz) * uAmp;
}`)
        .replace('#include <beginnormal_vertex>', `vec2 seaEN0 = vec2((modelMatrix * vec4(position, 1.0)).x, -(modelMatrix * vec4(position, 1.0)).z);
vec3 seaT = seaTex(seaEN0);
float seaH = seaT.x; vec2 seaDisp = seaT.yz;
// impact surges: expanding rings of raised water (same formula as world/waves.ts surgeHeight)
vec2 surgeG = vec2(0.0);
for (int i = 0; i < 4; i++) {
  vec4 S = uSurge[i];
  if (S.w > 0.0 && S.z >= 0.0 && S.z < 40.0) {
    vec2 d = seaEN0 - S.xy; float r = max(length(d), 0.001), a = S.z;
    float front = ${SURGE_SPEED.toFixed(1)} * a, w = 14.0 + 6.0 * a, x = (r - front) / w;
    float env = exp(-a / 12.0) / (1.0 + r / 60.0), ex = exp(-x * x);
    float ramp = smoothstep(0.0, 1.6, a);
    float ring = S.w * 14.0 * env * ex * (1.0 - 0.45 * x);
    float cen = S.w * 10.0 * exp(-a * 0.9) * exp(-(r * r) / (90.0 + 160.0 * a));
    seaH += ramp * (ring + cen);
    float dr = S.w * 14.0 * env * ex * (-2.0 * x / w * (1.0 - 0.45 * x) - 0.45 / w) + cen * (-2.0 * r / (90.0 + 160.0 * a));
    surgeG += ramp * dr * d / r;
  }
}
vec3 objectNormal = vec3(0.0, 1.0, 0.0);   // the true per-pixel normal is built in the fragment shader from the wave tiles
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
transformed.x += seaDisp.x * 1.0; transformed.z -= seaDisp.y * 1.0;      // choppy: crests are pushed together
transformed.y += seaH;
vSeaH = seaH; vSurgeG = surgeG;
vSeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uAmp; uniform float uNight; uniform float uUnder; uniform sampler2D uDetail; uniform sampler2D uDepth; uniform vec2 uDepthC; uniform float uHole; uniform vec2 uHoleC;
uniform sampler2D uTA1; uniform sampler2D uTA2; uniform sampler2D uTB1; uniform sampler2D uTB2;
varying vec3 vSeaW; varying float vSeaH; varying vec2 vSurgeG;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // fine ripples on top of the wave shape (two scrolling layers), fading with distance so the far sea stays calm and sparkly
  vec2 p = vSeaW.xz;
  float dd = length(vSeaW - cameraPosition);
  float nearR = 1.0 - smoothstep(60.0, 5000.0, dd);
  vec2 r1 = texture2D(uDetail, p / 13.0 + vec2(uTime * 0.04, uTime * 0.03)).rg - 0.5;
  vec2 r2 = texture2D(uDetail, p / 4.3 - vec2(uTime * 0.07, uTime * 0.05) + 0.37).ba - 0.5;
  vec3 wn = normalize(vec3((r1.x + 0.6 * r2.x) * 0.26 * nearR, 1.0, (r1.y + 0.6 * r2.y) * 0.26 * nearR));

  // the per-pixel wave normal, read from the wave tiles (mip-filtered by the GPU, so far water is smooth and never shimmers)
  vec2 enF = vec2(vSeaW.x, -vSeaW.z);
  vec3 sA = texture(uTA1, enF / ${CA.T.toFixed(1)}).xyz, sB = texture(uTB1, enF / ${CB.T.toFixed(1)}).xyz;
  vec3 sl = (sA + sB) * uAmp;                                   // (slope east, slope north, vertical squeeze)
  vec3 nw = normalize(vec3(-sl.x - vSurgeG.x, 1.0 - sl.z, sl.y + vSurgeG.y));
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz) * faceDirection;
  normal = normalize(normal + (viewMatrix * vec4(wn.x, 0.0, wn.z, 0.0)).xyz * 0.9);
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
if (uHole > 0.0 && abs(vSeaW.x - uHoleC.x) < uHole && abs(vSeaW.z - uHoleC.y) < uHole) discard;   // the finer grid covers this part
float seaFoam = 0.0, seaFoamRough = 0.0; vec3 seaEmit = vec3(0.0);
{
  float dd2 = length(vSeaW - cameraPosition);
  vec2 dUv = (vSeaW.xz - uDepthC) / ${DEPTH_SIZE.toFixed(1)} + 0.5;
  float dist = (dUv.x > 0.0 && dUv.x < 1.0 && dUv.y > 0.0 && dUv.y < 1.0) ? texture2D(uDepth, vec2(dUv.x, 1.0 - dUv.y)).r * 600.0 : 600.0;
  float deep = smoothstep(8.0, 380.0, dist);                          // 0 at the shore, 1 well out
  vec3 shallowC = vec3(0.02, 0.17, 0.20), midC = vec3(0.006, 0.07, 0.14), deepC = vec3(0.002, 0.02, 0.07);
  vec3 body = mix(shallowC, mix(midC, deepC, smoothstep(0.35, 1.0, deep)), smoothstep(0.0, 0.5, deep));
  float crestH = clamp(vSeaH / (2.2 * max(uAmp, 1.0) + 0.01) * 0.5 + 0.5, 0.0, 1.0);
  body += vec3(0.01, 0.07, 0.06) * smoothstep(0.55, 1.0, crestH) * (0.4 + 0.6 * (1.0 - deep));   // light scattering through thin crests
  diffuseColor.rgb = body;
  // foam: where the surface folds (Jacobian < ~0.5) = breaking crests, broken up with noise, plus a surf line along shores
  float n = texture2D(uDetail, vSeaW.xz / 7.0 + uTime * 0.02).r * 0.55 + texture2D(uDetail, vSeaW.xz / 2.6 - uTime * 0.03).g * 0.45;
  vec3 jA = texture(uTA2, vSeaW.xz * vec2(1.0, -1.0) / ${CA.T.toFixed(1)}).xyz, jB = texture(uTB2, vSeaW.xz * vec2(1.0, -1.0) / ${CB.T.toFixed(1)}).xyz;
  vec3 jj = (jA + jB) * uAmp;
  float jac = (1.0 - jj.x) * (1.0 - jj.y) - jj.z * jj.z;
  float fold = smoothstep(0.62, 0.12, jac);
  float surf = (1.0 - smoothstep(4.0, 38.0, dist)) * (0.55 + 0.45 * sin(dist * 0.55 - uTime * 1.6 + n * 5.0));
  seaFoam = clamp(fold * smoothstep(0.30, 0.75, n + fold * 0.4) + surf * smoothstep(0.35, 0.8, n), 0.0, 1.0) * (1.0 - smoothstep(900.0, 6000.0, dd2));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.88, 0.92), seaFoam * 0.9);
  seaFoamRough = seaFoam;
  if (!gl_FrontFacing) {
    // seen from below: Snell's window - sky visible only within ~48.6 degrees of straight up, a mirror of the dark water outside it
    vec3 V = normalize(vSeaW - cameraPosition);                         // ray direction from the camera to the surface
    float win = smoothstep(0.60, 0.70, V.y);
    vec3 sky = vec3(0.30, 0.62, 0.90) * (0.7 + 0.5 * pow(max(V.y, 0.0), 2.0));
    seaEmit = mix(vec3(0.004, 0.04, 0.07), sky, win);
    diffuseColor.rgb = vec3(0.0);
  }
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.07, 0.85, seaFoamRough);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += seaEmit;`);
    };
    mat.customProgramCacheKey = () => 'sea-surface-v7';
    return mat;
  }

  /** Distance-to-shore map around the camera (metres, 0..600) for the water colour and the surf line. */
  private updateDepth(cam: THREE.Vector3) {
    const cx = cam.x, cn = -cam.z, step = DEPTH_SIZE / DEPTH_N, d = this.depthData;
    this.depthCam.set(cx, cn); this.depthC.value.set(cx, cam.z);
    const INF = 9999, f = new Float32Array(DEPTH_N * DEPTH_N);
    for (let j = 0; j < DEPTH_N; j++) for (let i = 0; i < DEPTH_N; i++) {
      const e = cx + (i - DEPTH_N / 2 + 0.5) * step, n = cn + (DEPTH_N / 2 - j - 0.5) * step;
      const water = this.world.landAt(e, n) === LC.WATER && this.world.heightAt(e, n) < 3;
      f[j * DEPTH_N + i] = water ? INF : 0;
    }
    const w = DEPTH_N;                                   // chamfer distance transform (two passes), in cells
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) { const k = j * w + i; let v = f[k]; if (i > 0) v = Math.min(v, f[k - 1] + 1); if (j > 0) { v = Math.min(v, f[k - w] + 1); if (i > 0) v = Math.min(v, f[k - w - 1] + 1.41); if (i < w - 1) v = Math.min(v, f[k - w + 1] + 1.41); } f[k] = v; }
    for (let j = w - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) { const k = j * w + i; let v = f[k]; if (i < w - 1) v = Math.min(v, f[k + 1] + 1); if (j < w - 1) { v = Math.min(v, f[k + w] + 1); if (i < w - 1) v = Math.min(v, f[k + w + 1] + 1.41); if (i > 0) v = Math.min(v, f[k + w - 1] + 1.41); } f[k] = v; }
    for (let k = 0; k < w * w; k++) d[k] = Math.min(255, Math.round((Math.min(f[k] * step, 600) / 600) * 255));
    this.depthTex.needsUpdate = true;
  }

  update(cam: THREE.Vector3, night: number, camUnder: boolean) {
    this.uniforms.uTime.value = sea.t; this.uniforms.uAmp.value = sea.amp; this.uniforms.uNight.value = night; this.uniforms.uUnder.value = camUnder ? 1 : 0;
    this.under = camUnder;
    this.runSim();
    if (Math.hypot(cam.x - this.depthCam.x, -cam.z - this.depthCam.y) > 700) this.updateDepth(cam);
    const U = this.surgeU.value;
    for (let i = 0; i < 4; i++) { const g = surges[i]; if (g) U[i].set(g.e, g.n, sea.t - g.t0, g.s); else U[i].set(0, 0, 0, 0); }
    this.floor.position.x = cam.x; this.floor.position.z = cam.z;
    this.meshes.forEach(({ m, cell }, i) => { m.position.x = Math.round(cam.x / cell) * cell; m.position.z = Math.round(cam.z / cell) * cell; if (i > 0) this.holeCs[i].value.set(this.meshes[i - 1].m.position.x, this.meshes[i - 1].m.position.z); });
    this.snow.visible = camUnder;
    if (camUnder) {
      const p = (this.snow.geometry.getAttribute('position') as THREE.BufferAttribute), R = 36;
      for (let i = 0; i < p.count; i++) {
        const t = sea.t * 0.05;
        p.setXYZ(i, cam.x + ((this.snowBase[3 * i] * 2 + t * 0.7) % 2 - 1) * R, cam.y + ((this.snowBase[3 * i + 1] * 2 - t * 1.3) % 2 - 1) * R, cam.z + ((this.snowBase[3 * i + 2] * 2 + t * 0.5) % 2 - 1) * R);
      }
      p.needsUpdate = true;
    }
  }
}
