// Scattered cumulus: each cloud is a 3D cluster of soft, sun-lit puffs (instanced camera-facing
// billboards with per-puff shading by height and sun direction). Clouds are anchored to world
// cells, so they stay put as you fly past, and you can climb through them and fly above them.
// This approximates volume with stacked puffs; it is not ray-marched.

import * as THREE from 'three';

const CELL = 2200; // m
const RADIUS_CELLS = 9; // cells each side of the camera (~20 km)
const FT = 0.3048;

function hash(i: number, j: number, k: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class CloudField {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private aPos: THREE.InstancedBufferAttribute;
  private aInfo: THREE.InstancedBufferAttribute; // size, seed, height fraction
  private cap = 9000;
  private cx = 1e9; private cz = 1e9; private lastCover = -1; private lastBase = -1;
  private data: { x: number; y: number; z: number; s: number }[] = [];
  private mat: THREE.ShaderMaterial;
  private drift = new THREE.Vector2();

  constructor(scene: THREE.Scene, noise: THREE.Texture) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aInfo.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', this.aPos);
    this.geo.setAttribute('aInfo', this.aInfo);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: noise }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
        uCam: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 }, uOffset: { value: new THREE.Vector3() },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aPos; attribute vec3 aInfo;
        uniform vec3 uSun; uniform vec3 uOffset;
        varying vec2 vUv; varying vec3 vSun; varying float vH; varying float vSeed; varying vec3 vW;
        void main() {
          vUv = uv; vH = aInfo.z; vSeed = aInfo.y;
          vec3 wp = aPos + uOffset;
          vW = wp;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          mv.xy += position.xy * aInfo.x;
          vSun = normalize(mat3(viewMatrix) * uSun);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uNoise; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uCam; uniform vec3 uFogCol; uniform float uFogD;
        varying vec2 vUv; varying vec3 vSun; varying float vH; varying float vSeed; varying vec3 vW;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 uv = vUv * 2.0 - 1.0;
          float r = length(uv);
          if (r > 1.0) discard;
          vec2 q = uv * 0.42 + vec2(vSeed * 7.3, vSeed * 3.1);
          float n = texture2D(uNoise, q).r * 0.6 + texture2D(uNoise, q * 2.7 + 0.37).g * 0.4;
          float shape = (1.0 - r) + (n - 0.5) * 0.75;
          float a = smoothstep(0.02, 0.5, shape);
          if (a < 0.01) discard;
          vec3 nrm = normalize(vec3(uv * 0.9, sqrt(max(0.05, 1.0 - r * r))));
          float diff = clamp(dot(nrm, vSun) * 0.5 + 0.5, 0.0, 1.0);
          float shade = mix(0.35, 1.0, smoothstep(0.0, 0.65, vH));
          vec3 lit = uSunCol * 1.5 + uAmb * 0.9;
          vec3 dark = uAmb * 1.7 + uSunCol * 0.12;
          vec3 col = mix(dark, lit, diff * shade);
          float dist = length(vW - uCam);
          float fog = 1.0 - exp(-pow(uFogD * dist, 2.0));
          col = mix(col, uFogCol, fog);
          float fade = 1.0 - smoothstep(15000.0, 21000.0, dist);
          gl_FragColor = vec4(col, a * 0.92 * fade);
        }`,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Is the camera inside a cloud (0..1)? CPU test against the puff spheres. */
  densityAt(p: THREE.Vector3): number {
    if (!this.mesh.visible) return 0;
    let d = 0;
    const ox = this.drift.x, oz = this.drift.y;
    for (const q of this.data) {
      const dx = p.x - (q.x + ox), dy = p.y - q.y, dz = p.z - (q.z + oz);
      const r2 = dx * dx + dy * dy + dz * dz, R = q.s * 0.4;
      if (r2 < R * R) d = Math.max(d, 1 - Math.sqrt(r2) / R);
    }
    return Math.min(1, d * 1.6);
  }

  private rebuild(cell0x: number, cell0z: number, baseM: number, cover: number) {
    let n = 0;
    this.data = [];
    const pa = this.aPos.array as Float32Array, ia = this.aInfo.array as Float32Array;
    const prob = Math.min(0.97, cover * 1.9);
    for (let i = cell0x - RADIUS_CELLS; i <= cell0x + RADIUS_CELLS; i++) {
      for (let j = cell0z - RADIUS_CELLS; j <= cell0z + RADIUS_CELLS; j++) {
        if (hash(i, j, 1) > prob) continue;
        const ccx = (i + hash(i, j, 2)) * CELL, ccz = (j + hash(i, j, 3)) * CELL;
        const rad = CELL * (0.55 + 0.45 * hash(i, j, 4));
        const height = 700 + 1900 * hash(i, j, 5) * (0.5 + cover);
        const puffs = 8 + Math.floor(6 * hash(i, j, 6));
        for (let k = 0; k < puffs && n < this.cap; k++) {
          const a = hash(i, j, 10 + k) * Math.PI * 2, rr = Math.sqrt(hash(i, j, 40 + k)) * rad;
          const hf = hash(i, j, 70 + k); // 0 = base, 1 = top
          // towers: the cloud is tallest in the middle
          const mid = 1 - rr / rad;
          const y = baseM + 150 + hf * height * (0.35 + 0.65 * mid);
          const size = (520 + 650 * hash(i, j, 100 + k)) * (0.75 + 0.5 * Math.sin(hf * Math.PI));
          const x = ccx + Math.cos(a) * rr, z = ccz + Math.sin(a) * rr;
          pa[3 * n] = x; pa[3 * n + 1] = y; pa[3 * n + 2] = z;
          ia[3 * n] = size; ia[3 * n + 1] = hash(i, j, 130 + k) * 10; ia[3 * n + 2] = hf;
          this.data.push({ x, y, z, s: size });
          n++;
        }
      }
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aInfo.needsUpdate = true;
  }

  update(cam: THREE.Vector3, baseFt: number, cover: number, simTime: number, sun: THREE.Vector3, sunCol: THREE.Color, amb: THREE.Color, fogCol: THREE.Color, fogD: number) {
    const on = cover > 0.05 && cover < 0.9;
    this.mesh.visible = on;
    if (!on) return;
    // slow wind drift of the whole field (world cells are re-indexed relative to the drift)
    this.drift.set(simTime * 4.0, simTime * 1.5);
    const baseM = baseFt * FT;
    const cx = Math.floor((cam.x - this.drift.x) / CELL), cz = Math.floor((cam.z - this.drift.y) / CELL);
    if (cx !== this.cx || cz !== this.cz || Math.abs(cover - this.lastCover) > 0.01 || baseM !== this.lastBase) {
      this.cx = cx; this.cz = cz; this.lastCover = cover; this.lastBase = baseM;
      this.rebuild(cx, cz, baseM, cover);
    }
    const u = this.mat.uniforms;
    u.uOffset.value.set(this.drift.x, 0, this.drift.y);
    u.uSun.value.copy(sun);
    u.uSunCol.value.copy(sunCol); u.uAmb.value.copy(amb);
    u.uCam.value.copy(cam);
    u.uFogCol.value.copy(fogCol); u.uFogD.value = fogD;
  }
}
