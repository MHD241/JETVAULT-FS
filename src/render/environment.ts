// Sky, sun, lighting, fog, clouds and rain, all driven by WeatherSettings (the same
// settings the flight model uses for wind, turbulence, temperature and pressure).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CloudField } from './cloudField';
import { clockNow, WeatherSettings, CloudCover } from '../sim/weather';
import { EGPH_ORIGIN } from '../world/geo';
import { FT } from '../core/math';

const COVER: Record<CloudCover, number> = { SKC: 0, FEW: 0.18, SCT: 0.4, BKN: 0.7, OVC: 0.97 };

/** Solar elevation/azimuth (deg) for latitude/longitude, day of year and UTC hours. */
export function sunPosition(lat: number, lon: number, day: number, utcHours: number) {
  const d2r = Math.PI / 180;
  const decl = 23.44 * Math.sin((2 * Math.PI * (day - 81)) / 365) * d2r;
  const B = (2 * Math.PI * (day - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const solar = utcHours + lon / 15 + eot / 60;
  const H = (solar - 12) * 15 * d2r;
  const phi = lat * d2r;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { elevation: el / d2r, azimuth: ((az / d2r) + 360) % 360 };
}

/** Moon position (low-precision ephemeris, good to about a degree), illuminated fraction and whether it is waxing, for an observer at lat/lon at UTC time ms. */
export function moonPosition(lat: number, lon: number, ms: number) {
  const d2r = Math.PI / 180, d = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = 218.316 + 13.176396 * d, M = 134.963 + 13.064993 * d, F = 93.272 + 13.22935 * d;
  const lam = (L + 6.289 * Math.sin(M * d2r)) * d2r, bet = 5.128 * Math.sin(F * d2r) * d2r, eps = 23.4397 * d2r;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
  const lst = (280.16 + 360.9856235 * d + lon) * d2r, H = lst - ra, phi = lat * d2r;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  const g = 357.528 + 0.9856003 * d, sunLon = (280.46 + 0.9856474 * d + 1.915 * Math.sin(g * d2r) + 0.02 * Math.sin(2 * g * d2r)) * d2r;
  const elong = lam - sunLon;
  return { elevation: el / d2r, azimuth: ((az / d2r) + 360) % 360, illum: (1 - Math.cos(elong)) / 2, waxing: Math.sin(elong) > 0 };
}

function moonCanvas(illum: number, waxing: boolean) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!, c = 64, R = 58;
  g.translate(c, c); if (!waxing) g.scale(-1, 1);
  g.fillStyle = 'rgba(46,52,64,0.55)'; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();        // the unlit side, faint earthshine
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#efecdf'; g.beginPath(); g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false); g.fill();    // lit right half
  const k = 1 - 2 * illum;                                                                               // crescent: >0, gibbous: <0
  g.fillStyle = k > 0 ? 'rgba(46,52,64,0.9)' : '#efecdf'; g.beginPath(); g.ellipse(0, 0, Math.max(0.5, Math.abs(k) * R), R, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(120,118,110,0.35)';                                                               // a few maria
  for (const [x, y, r] of [[-14, -16, 13], [10, -6, 10], [-6, 14, 12], [20, 18, 7]] as [number, number, number][]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
  return cv;
}

export class EnvironmentRenderer {
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  private clouds: THREE.Mesh[] = [];
  private field!: CloudField;
  private cloudMat: THREE.ShaderMaterial;
  private rain: THREE.LineSegments;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  private lastEnvSun = new THREE.Vector3(0, -1, 0);
  sunDir = new THREE.Vector3(0, 1, 0);
  sunElevation = 45;
  /** 0..1: how strongly the real sun shines right now (from its true elevation for this date, time and place, dimmed by cloud cover); drives the glare. */
  sunShine = 1;
  /** 0 at sea level .. 1 above ~100 km: the sky fades to black and stars appear (smooth, starting around 15 km). */
  space = 0;
  private spaceU = { value: 0 };
  private stars!: THREE.Points;
  night = 0;
  lightLevel = 0;
  coverage = 0.4;
  inCloud = 0;
  /** Lighting calibration (exposed for tuning). */
  /** Visible sun: a hot core and a wide glow, billboarded far away; clouds (drawn later) cover it. */
  private sunCore!: THREE.Sprite; get sunCoreSprite() { return this.sunCore; }
  private twiU = { value: 0 }; private sunDU = { value: new THREE.Vector3(0, 1, 0) };
  /** The sun as a real 3D sphere ("The Sun" by tamminen, CC BY 4.0), drawn at the sun's true position; the soft sprites are its halo. */
  sunBody: THREE.Group | null = null;
  moon!: THREE.Sprite; moonBody: THREE.Group | null = null; private moonKey = '';
  /** Moon elevation (deg) and illuminated fraction, for the night ambient light and the sky. */
  moonElevation = -90; moonIllum = 0;
  private sunGlow!: THREE.Sprite; // wide halo: no longer shown (glow/bloom look removed)
  tune = { sun: 3.6, hemi: 0.3, env: 0.3, exposure: 0.45 };
  private noise: Uint8Array;
  private noiseSize: number;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, noiseTex: THREE.DataTexture) {
    this.sky = new Sky();
    this.sky.scale.setScalar(400000);
    // deep-blue zenith fading to a pale hazy horizon (the stock atmosphere model alone is washed out after tone mapping)
    this.sky.material.onBeforeCompile = (sh) => {
      sh.uniforms.uSpace = this.spaceU; sh.uniforms.uTwi = this.twiU; sh.uniforms.uSunD = this.sunDU;
      sh.fragmentShader = 'uniform float uSpace; uniform float uTwi; uniform vec3 uSunD;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );',
        'float skyE = clamp(normalize(vWorldPosition - cameraPosition).y, 0.0, 1.0);\n texColor *= mix(vec3(1.0), vec3(0.07, 0.30, 1.6), smoothstep(0.0, 0.2, skyE)); texColor = mix(texColor, texColor * vec3(0.9,0.95,1.0), smoothstep(0.0, 0.1, skyE));\n // thinning atmosphere: black overhead, a bright blue limb stays along the horizon\n float yRaw = normalize(vWorldPosition - cameraPosition).y;\n texColor *= pow(1.0 - uSpace * smoothstep(0.0, 0.3, skyE), 4.0) * mix(1.0, 0.22, uSpace) * (1.0 - uSpace * (1.0 - smoothstep(-0.05, 0.0, yRaw)));\n texColor += vec3(0.10, 0.28, 0.95) * 0.7 * uSpace * exp(-abs(yRaw + 0.01) * 22.0);   // the blue atmosphere limb\n // sunrise / sunset: a warm band along the horizon on the sun side (orange at the horizon, pink above, blue-purple on the far side)\n vec3 vd = normalize(vWorldPosition - cameraPosition); float toSun = max(dot(normalize(vec3(vd.x, 0.0, vd.z)), normalize(vec3(uSunD.x, 0.0, uSunD.z))), 0.0);\n float band = exp(-max(vd.y, 0.0) * 5.0) * (0.25 + 0.75 * pow(toSun, 3.0)), halo = pow(max(dot(vd, uSunD), 0.0), 8.0) * exp(-max(vd.y, 0.0) * 2.5);\n vec3 pinkTop = vec3(0.95, 0.35, 0.45) * smoothstep(0.02, 0.35, vd.y) * (1.0 - smoothstep(0.35, 0.8, vd.y));\n texColor = mix(texColor, texColor * 0.45 + vec3(1.35, 0.5, 0.15) * band + vec3(1.4, 0.65, 0.25) * halo * 0.9 + pinkTop * (0.2 + 0.8 * toSun) * 0.6, uTwi * (1.0 - uSpace));\n texColor += vec3(0.22, 0.10, 0.22) * uTwi * smoothstep(0.1, 0.5, vd.y) * (1.0 - toSun) * 0.25;\n gl_FragColor = vec4( texColor, 1.0 );');
    };
    this.sky.material.depthWrite = false;
    scene.add(this.sky);
    {
      // stars: ~4500 points on a huge sphere (seeded, so the same sky every time), faded in with altitude and at night
      const N = 4500, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      let sd = 12345; const rnd = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < N; i++) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z), R = 300000;
        pos.set([Math.cos(a) * r * R, z * R, Math.sin(a) * r * R], i * 3);
        const b = 0.35 + 0.65 * Math.pow(rnd(), 3), t = rnd();
        col.set([b * (0.85 + 0.15 * t), b * (0.9 + 0.1 * (1 - t)), b], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
      this.stars.renderOrder = 1; this.stars.frustumCulled = false; this.stars.visible = false; scene.add(this.stars);
    }
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 1; sc.far = 2600;
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.blurSamples = 16;
    scene.add(this.sun, this.sun.target);
    const disc = (stops: [number, string][]) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const g = cv.getContext('2d')!, gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const mk = (tex: THREE.Texture, order: number) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, fog: false }));
      m.renderOrder = order; m.frustumCulled = false; scene.add(m); return m;
    };
    this.sunGlow = mk(disc([[0, 'rgba(255,248,225,0.55)'], [0.1, 'rgba(255,238,195,0.4)'], [0.22, 'rgba(255,222,165,0.1)'], [0.5, 'rgba(255,205,140,0.012)'], [1, 'rgba(255,190,120,0)']]), 5);
    this.sunCore = mk(disc([[0, 'rgba(255,250,225,1)'], [0.10, 'rgba(255,246,205,1)'], [0.135, 'rgba(255,236,170,0.95)'], [0.165, 'rgba(255,214,120,0.35)'], [0.2, 'rgba(255,190,90,0.34)'], [0.34, 'rgba(255,160,70,0.2)'], [0.6, 'rgba(255,130,55,0.07)'], [1, 'rgba(255,110,40,0)']]), 5);   // like the reference: a crisp small bright sun with a tight orange halo
    this.moon = mk(new THREE.CanvasTexture(moonCanvas(0.5, true)), 5); this.moon.material.blending = THREE.NormalBlending; this.moon.visible = false;
    new GLTFLoader().load('./models/the_sun.glb', (g) => {
      // keep the largest sphere only, as an unlit glowing body (no lighting, no fog, no tone-mapping: it is the light source)
      let best: THREE.Mesh | null = null, br = 0;
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.computeBoundingSphere(); const r = m.geometry.boundingSphere!.radius * Math.max(...m.getWorldScale(new THREE.Vector3()).toArray()); if (r > br) { br = r; best = m; } } });
      if (!best) return;
      const b = best as THREE.Mesh; b.geometry.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.78, 0.4), toneMapped: false, fog: false, depthWrite: false, transparent: true });
      const mesh = new THREE.Mesh(b.geometry, mat); mesh.renderOrder = 6; mesh.frustumCulled = false;
      const grp = new THREE.Group(); grp.add(mesh); (grp as THREE.Group & { unit?: number }).unit = 1 / b.geometry.boundingSphere!.radius;
      grp.visible = false; scene.add(grp); this.sunBody = grp;
    }, undefined, (e) => { console.warn('sun model not loaded', e); });
    // the moon as a real textured sphere ("Moon" by Akshat, CC BY 4.0; geometry from the model, its photo texture), lit by the sun's real direction
    // in a small shader, so the phase you see is the true one; it keeps the same face towards the viewer, like the real moon
    new GLTFLoader().load('./models/moon.glb', (g) => {
      let geo: THREE.BufferGeometry | null = null;
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !geo) geo = m.geometry; });
      if (!geo) return;
      const tx = new THREE.TextureLoader().load('./models/moon.jpg'); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: tx }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uOp: { value: 1 } },
        vertexShader: 'varying vec2 vUv; varying vec3 vN; void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D uTex; uniform vec3 uSun; uniform float uOp; varying vec2 vUv; varying vec3 vN; void main() { vec3 c = texture2D(uTex, vUv).rgb; float l = clamp(dot(normalize(vN), normalize(uSun)), 0.0, 1.0); l = smoothstep(0.0, 0.55, l); vec3 col = c * (0.035 + 1.9 * l) * vec3(1.0, 0.97, 0.9); gl_FragColor = vec4(col, uOp); }',
        transparent: true, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 6; mesh.frustumCulled = false;
      const grp = new THREE.Group(); grp.add(mesh); grp.visible = false; scene.add(grp); this.moonBody = grp;
    }, undefined, (e) => { console.warn('moon model not loaded', e); });
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4a3a, 0.6);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xc8d4e2, 0.00004);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.noise = noiseTex.image.data as Uint8Array;
    this.noiseSize = noiseTex.image.width;
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: noiseTex }, uCover: { value: 0.4 }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
        uAmb: { value: new THREE.Color() }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uLayer: { value: 0 },
        uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 },
      },
      vertexShader: `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform sampler2D uNoise; uniform float uCover; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb;
        uniform float uTime; uniform vec3 uCam; uniform float uLayer; uniform vec3 uFogCol; uniform float uFogD;
        varying vec3 vW;
        float fbm(vec2 p) {
          float v = texture2D(uNoise, p / 9000.0).r * 0.5 + texture2D(uNoise, p / 3100.0).g * 0.3 + texture2D(uNoise, p / 900.0).b * 0.2;
          return v;
        }
        void main() {
          vec2 p = vW.xz + vec2(uTime * 4.0, uTime * 1.5);
          float n = fbm(p + uLayer * 517.0);
          float th = 1.0 - uCover;
          float d = smoothstep(th - 0.06, th + 0.12, n * 0.9 + 0.08 + uLayer * 0.02);
          if (d < 0.01) discard;
          float below = step(uCam.y, vW.y);
          float lit = clamp(uSun.y * 1.5 + 0.2, 0.0, 1.0);
          vec3 top = uSunCol * (0.6 + 0.6 * lit) + uAmb * 0.8;
          vec3 bottom = top * 1.3 * mix(vec3(0.66, 0.74, 0.88), vec3(0.93, 0.96, 1.0), 1.0 - d);   // white edges, soft blue-grey bellies
          vec3 col = mix(top, bottom, below * 0.85);
          float dist = length(vW - uCam);
          float fog = 1.0 - exp(-pow(uFogD * dist, 2.0));
          col = mix(col, uFogCol, fog);
          float edge = 1.0 - smoothstep(18000.0, 30000.0, length(vW.xz - uCam.xz));
          gl_FragColor = vec4(col, d * edge * 0.97);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(64000, 64000, 1, 1), this.cloudMat.clone());
      m.rotation.x = -Math.PI / 2;
      (m.material as THREE.ShaderMaterial).uniforms.uLayer.value = i;
      m.renderOrder = 2 + i;
      m.frustumCulled = false;
      this.clouds.push(m);
      scene.add(m);
    }
    this.field = new CloudField(scene, noiseTex);
    // rain streaks
    const N = 6000;
    const rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 80, y = (Math.random() - 0.5) * 60, z = (Math.random() - 0.5) * 80;
      rp.set([x, y, z, x, y - 0.6, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb0c0, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  /** CPU sample of the cloud density at a three.js position (for fly-through fog). */
  private cloudDensityAt(x: number, z: number, time: number, layer: number) {
    const s = this.noiseSize;
    const tap = (px: number, pz: number, scale: number, ch: number) => {
      let u = ((px / scale) % 1 + 1) % 1, v = ((pz / scale) % 1 + 1) % 1;
      const ix = Math.floor(u * s), iz = Math.floor(v * s);
      return this.noise[(iz * s + ix) * 4 + ch] / 255;
    };
    const px = x + time * 4 + layer * 517, pz = z + time * 1.5 + layer * 517;
    const n = tap(px, pz, 9000, 0) * 0.5 + tap(px, pz, 3100, 1) * 0.3 + tap(px, pz, 900, 2) * 0.2;
    const th = 1 - this.coverage;
    const t = THREE.MathUtils.clamp((n * 0.9 + 0.08 + layer * 0.02 - (th - 0.06)) / 0.18, 0, 1);
    return t * t * (3 - 2 * t);
  }

  update(w: WeatherSettings, simTime: number, cam: THREE.Vector3, focus: THREE.Vector3, where: { lat: number; lon: number } = { lat: EGPH_ORIGIN.lat, lon: EGPH_ORIGIN.lon }) {
    const clk = clockNow(w, simTime);
    const sp = sunPosition(where.lat, where.lon, clk.day, clk.utc);       // the sun at the place the aircraft actually is
    const mp = moonPosition(where.lat, where.lon, clk.ms);
    this.moonElevation = mp.elevation; this.moonIllum = mp.illum;
    this.sunElevation = sp.elevation;
    const el = (sp.elevation * Math.PI) / 180, az = (sp.azimuth * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.coverage = COVER[w.cloudCover];
    const overcast = Math.max(0, this.coverage - 0.5) * 2; // 0..1 for BKN/OVC

    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(this.sunDir);
      u.turbidity.value = 1.1 + overcast * 10 + w.rain * 6;   // clearer air: deeper blue zenith
      u.rayleigh.value = 6.0 + overcast * 1.0;
      u.mieCoefficient.value = 0.0006 + overcast * 0.02;
      u.mieDirectionalG.value = 0.85;
    }
    this.sky.position.copy(cam);
    {
      // sun disc: 1.6 deg core, ~22 deg glow; hidden below the horizon, dimmer and warmer when low or overcast
      const D = 200000, vis = THREE.MathUtils.smoothstep(sp.elevation, -3.2, 0.5);
      const low = 1 - THREE.MathUtils.smoothstep(sp.elevation, 2, 25);
      // the disc is small high in the sky (5 deg) and swells as it sinks (up to 13 deg at the horizon, like the real sun looks) until it has set
      const grow = 1 - THREE.MathUtils.smoothstep(sp.elevation, 0, 35), discAng = 22 + 14 * grow, glowAng = 60 + 70 * grow;
      for (const [s, ang, k] of [[this.sunCore, discAng, 1.0], [this.sunGlow, glowAng, 0.35 + 0.45 * grow]] as [THREE.Sprite, number, number][]) {
        s.position.copy(cam).addScaledVector(this.sunDir, D);
        s.scale.setScalar(2 * D * Math.tan((ang * Math.PI) / 360));
        const m = s.material as THREE.SpriteMaterial;
        m.color.setRGB(1.6, 1.5 - 0.75 * low, 1.25 - 1.0 * low);   // white-hot high up, glowing orange-red as it sets
        m.opacity = Math.min(1, vis * k * (1 - 0.65 * overcast));
        s.visible = vis > 0.01;
      }
      if (this.sunBody) {
        // the 3D sun: about 5 degrees across when it is high, swelling a little as it sets; yellow-white when high, deep orange at the horizon
        const gr = this.sunBody, u = (gr as THREE.Group & { unit?: number }).unit ?? 1, ang = 4.2 + 3.4 * grow;
        gr.position.copy(cam).addScaledVector(this.sunDir, D); gr.scale.setScalar(u * D * Math.tan((ang * Math.PI) / 360));
        const mm = (gr.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial; mm.color.setRGB(4.0, 3.6 - 1.4 * low, 2.6 - 1.9 * low);   // over-bright: the grade and tone-mapping pass brings it down to a white-yellow sun mm.opacity = Math.min(1, vis * (1 - 0.5 * overcast));
        gr.visible = vis > 0.01;
      }
    }

    {
      // the moon: real position and phase for this place and time; a billboard far away (drawn over the clouds like the sun), phase redrawn when it changes
      const D = 200000, mel = (mp.elevation * Math.PI) / 180, maz = (mp.azimuth * Math.PI) / 180;
      const mdir = new THREE.Vector3(Math.sin(maz) * Math.cos(mel), Math.sin(mel), -Math.cos(maz) * Math.cos(mel));
      const key = Math.round(mp.illum * 60) + (mp.waxing ? 'w' : 'n');
      if (key !== this.moonKey) { this.moonKey = key; const tx = new THREE.CanvasTexture(moonCanvas(mp.illum, mp.waxing)); tx.colorSpace = THREE.SRGBColorSpace; const m = this.moon.material as THREE.SpriteMaterial; m.map?.dispose(); m.map = tx; m.needsUpdate = true; }
      const vis = THREE.MathUtils.smoothstep(mp.elevation, -1.5, 2);
      this.moon.position.copy(cam).addScaledVector(mdir, D);
      this.moon.scale.setScalar(2 * D * Math.tan((6.0 * Math.PI) / 360));     // drawn about 12x its real size so it reads clearly as a moon, like the big sun
      (this.moon.material as THREE.SpriteMaterial).opacity = vis * (0.3 + 0.7 * THREE.MathUtils.smoothstep(-sp.elevation, -2, 8)) * (1 - 0.55 * overcast);
      this.moon.visible = vis > 0.01 && !this.moonBody;
      if (this.moonBody) {
        const gr = this.moonBody, mm = (gr.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
        gr.position.copy(cam).addScaledVector(mdir, D); gr.scale.setScalar(D * Math.tan((5.5 * Math.PI) / 360));     // about 11x its real size so it reads clearly
        gr.lookAt(cam);                                                                                              // the same face always towards the viewer
        mm.uniforms.uSun.value.copy(this.sunDir); mm.uniforms.uOp.value = vis * (0.3 + 0.7 * THREE.MathUtils.smoothstep(-sp.elevation, -2, 8)) * (1 - 0.55 * overcast);
        gr.visible = vis > 0.01;
      }
    }

    // night factor from solar elevation (civil twilight)
    this.night = THREE.MathUtils.smoothstep(-sp.elevation, -2, 10);
    const dayLight = THREE.MathUtils.smoothstep(sp.elevation, -4, 12);
    const twi = Math.min(1, 1.25 * Math.exp(-Math.pow((sp.elevation - 2) / 9, 2))) * (1 - 0.6 * overcast);   // golden hour: from about 15 degrees down to civil twilight
    this.sunShine = THREE.MathUtils.smoothstep(sp.elevation, -1, 6) * (1 - 0.75 * overcast) * (1 - 0.8 * twi);   // the screen glare is mostly switched off at sunset: the sky glow and the big disc do the work
    const sunVis = THREE.MathUtils.smoothstep(sp.elevation, -1.5, 5) * (1 - 0.4 * overcast);   // stays strong right down to the horizon, so golden-hour shadows are crisp and long // thin overcast still casts clear shadows
    const warm = THREE.MathUtils.smoothstep(sp.elevation, 0, 25);
    // twilight strength: peaks as the sun crosses the horizon (golden hour just above, afterglow just below), zero at midday and deep night
    this.twiU.value = twi; this.sunDU.value.copy(this.sunDir);
    this.sun.color.setRGB(1, 0.50 + 0.50 * warm, 0.22 + 0.78 * warm);   // deep orange at the horizon, white at noon
    this.sun.intensity = this.tune.sun * sunVis;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 1200);
    this.sun.target.position.copy(focus);
    const moonGlow = Math.max(0, Math.sin((mp.elevation * Math.PI) / 180)) * mp.illum * (1 - dayLight);   // a bright moon lifts the night a little
    this.hemi.intensity = (0.4 + 0.6 * dayLight + 0.9 * moonGlow + 1.2 * twi) * this.tune.hemi;
    this.hemi.color.setRGB(0.75, 0.84, 1.0).lerp(new THREE.Color(1.0, 0.62, 0.42), Math.min(1, twi * 1.1));   // warm sky light on the ground at golden hour // moonlit / skyglow floor so the ground is not pitch black
    this.hemi.color.setRGB(0.62 + 0.2 * overcast, 0.72 + 0.12 * overcast, 0.9);
    this.hemi.groundColor.setRGB(0.3, 0.28, 0.22);

    // fog from visibility (5 % contrast at the visibility distance), whiteout inside cloud
    const camAlt = cam.y;
    const base = w.cloudBaseFt * FT;
    let inCloud = 0;
    if (this.coverage >= 0.9) {
      for (let l = 0; l < 2; l++) {
        const h = base + l * 150;
        const thick = 120 + 500 * this.coverage;
        if (camAlt > h - 20 && camAlt < h + thick) inCloud = Math.max(inCloud, this.cloudDensityAt(cam.x, cam.z, simTime, l));
      }
    }
    else if (this.coverage > 0.05) inCloud = this.field.densityAt(cam);
    this.inCloud = inCloud;
    this.space = THREE.MathUtils.smoothstep(camAlt, 15000, 100000);
    this.spaceU.value = this.space;
    const starA = Math.max(this.space, 0.85 * this.night);
    this.stars.visible = starA > 0.01; (this.stars.material as THREE.PointsMaterial).opacity = starA; this.stars.position.copy(cam);
    const vis = Math.max(50, Math.min(w.visibility, 120000) * (1 - 0.97 * inCloud));
    this.fog.density = Math.sqrt(3) / vis * 0.7 * (1 - 0.92 * this.space); // no thick haze in thin air
    const fogBright = 0.25 + 0.75 * dayLight;
    this.fog.color.setRGB(0.56 * fogBright, 0.70 * fogBright, 0.90 * fogBright).lerp(new THREE.Color(0.95, 0.55, 0.38).multiplyScalar(fogBright * 0.9), twi * 0.65).lerp(new THREE.Color(0.8, 0.8, 0.82).multiplyScalar(fogBright), overcast * 0.6 + inCloud);
    this.lightLevel = Math.max(this.night, w.visibility < 5000 ? 1 : 0, overcast * 0.4);

    // clouds: scattered 3D puff cumulus below overcast, flat noise layers for overcast
    this.field.update(cam, w.cloudBaseFt, this.coverage, simTime, this.sunDir,
      this.sun.color.clone().multiplyScalar(1.5 * dayLight + 0.03), new THREE.Color(0.55, 0.65, 0.85).multiplyScalar(0.3 + 1.0 * dayLight), this.fog.color, this.fog.density);
    for (let l = 0; l < this.clouds.length; l++) {
      const m = this.clouds[l];
      m.visible = this.coverage >= 0.9;
      m.position.set(Math.round(cam.x / 100) * 100, base + l * (120 + 500 * this.coverage) * 0.5, Math.round(cam.z / 100) * 100);
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uCover.value = this.coverage;
      u.uSun.value.copy(this.sunDir);
      u.uSunCol.value.copy(this.sun.color).multiplyScalar(1.5 * dayLight + 0.03);
      u.uAmb.value.setRGB(0.55, 0.65, 0.85).multiplyScalar(0.3 + 1.0 * dayLight);
      u.uTime.value = simTime;
      u.uCam.value.copy(cam);
      u.uFogCol.value.copy(this.fog.color);
      u.uFogD.value = this.fog.density;
    }

    // rain below the cloud base
    this.rain.visible = w.rain > 0.05 && camAlt < base + 100;
    if (this.rain.visible) {
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.15 + 0.35 * w.rain;
      this.rain.position.set(cam.x, cam.y - ((simTime * 9) % 30) + 15, cam.z);
    }

    // refresh the image-based lighting when the sun has moved
    if (!this.envRT || this.sunDir.distanceTo(this.lastEnvSun) > 0.03) {
      this.lastEnvSun.copy(this.sunDir);
      this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      this.scene.environment = this.envRT.texture;
    }
    this.scene.environmentIntensity = (0.3 + 0.7 * dayLight) * this.tune.env; // night floor: sky glow still lights aircraft and ground a little
  }
}
