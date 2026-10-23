// Sky, sun, lighting, fog, clouds and rain, all driven by WeatherSettings (the same
// settings the flight model uses for wind, turbulence, temperature and pressure).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CloudField } from './cloudField';
import { WeatherSettings, CloudCover } from '../sim/weather';
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
  night = 0;
  lightLevel = 0;
  coverage = 0.4;
  inCloud = 0;
  /** Lighting calibration (exposed for tuning). */
  tune = { sun: 2.6, hemi: 0.45, env: 0.35, exposure: 0.42 };
  private noise: Uint8Array;
  private noiseSize: number;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, noiseTex: THREE.DataTexture) {
    this.sky = new Sky();
    this.sky.scale.setScalar(400000);
    this.sky.material.depthWrite = false;
    scene.add(this.sky);
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 1500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
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
          vec3 bottom = mix(uAmb * 1.2, uSunCol * 0.35 + uAmb * 0.8, 1.0 - d) * (1.0 - 0.45 * uCover);
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

  update(w: WeatherSettings, simTime: number, cam: THREE.Vector3, focus: THREE.Vector3) {
    const utc = (w.timeOfDay + simTime / 3600) % 24;
    const sp = sunPosition(EGPH_ORIGIN.lat, EGPH_ORIGIN.lon, w.dayOfYear, utc);
    this.sunElevation = sp.elevation;
    const el = (sp.elevation * Math.PI) / 180, az = (sp.azimuth * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.coverage = COVER[w.cloudCover];
    const overcast = Math.max(0, this.coverage - 0.5) * 2; // 0..1 for BKN/OVC

    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(this.sunDir);
      u.turbidity.value = 4 + overcast * 10 + w.rain * 6;
      u.rayleigh.value = 1.2 + overcast * 1.5;
      u.mieCoefficient.value = 0.004 + overcast * 0.02;
      u.mieDirectionalG.value = 0.85;
    }
    this.sky.position.copy(cam);

    // night factor from solar elevation (civil twilight)
    this.night = THREE.MathUtils.smoothstep(-sp.elevation, -2, 10);
    const dayLight = THREE.MathUtils.smoothstep(sp.elevation, -4, 12);
    const sunVis = dayLight * (1 - 0.75 * overcast);
    const warm = THREE.MathUtils.smoothstep(sp.elevation, 0, 25);
    this.sun.color.setRGB(1, 0.72 + 0.28 * warm, 0.5 + 0.5 * warm);
    this.sun.intensity = this.tune.sun * sunVis;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 600);
    this.sun.target.position.copy(focus);
    this.hemi.intensity = (0.15 + 0.85 * dayLight) * this.tune.hemi;
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
    const vis = Math.max(50, Math.min(w.visibility, 80000) * (1 - 0.97 * inCloud));
    this.fog.density = Math.sqrt(3) / vis * 0.9;
    const fogBright = 0.25 + 0.75 * dayLight;
    this.fog.color.setRGB(0.70 * fogBright, 0.76 * fogBright, 0.84 * fogBright).lerp(new THREE.Color(0.8, 0.8, 0.82).multiplyScalar(fogBright), overcast * 0.6 + inCloud);
    this.lightLevel = Math.max(this.night, w.visibility < 5000 ? 1 : 0, overcast * 0.4);

    // clouds: scattered 3D puff cumulus below overcast, flat noise layers for overcast
    this.field.update(cam, w.cloudBaseFt, this.coverage, simTime, this.sunDir,
      this.sun.color.clone().multiplyScalar(0.55 * dayLight + 0.03), new THREE.Color(0.45, 0.5, 0.58).multiplyScalar(0.12 + 0.6 * dayLight), this.fog.color, this.fog.density);
    for (let l = 0; l < this.clouds.length; l++) {
      const m = this.clouds[l];
      m.visible = this.coverage >= 0.9;
      m.position.set(Math.round(cam.x / 100) * 100, base + l * (120 + 500 * this.coverage) * 0.5, Math.round(cam.z / 100) * 100);
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uCover.value = this.coverage;
      u.uSun.value.copy(this.sunDir);
      u.uSunCol.value.copy(this.sun.color).multiplyScalar(0.55 * dayLight + 0.03);
      u.uAmb.value.setRGB(0.45, 0.5, 0.58).multiplyScalar(0.12 + 0.6 * dayLight);
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
    this.scene.environmentIntensity = (0.1 + 0.9 * dayLight) * this.tune.env;
  }
}
