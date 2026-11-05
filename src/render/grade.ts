// Cinematic colour grading for the whole frame: HDR render -> grade (contrast, saturation, warm highlights / cool shadows,
// soft vignette, slight bloom-like highlight lift) -> ACES tone mapping and sRGB. Replaces the plain "render straight to screen".

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uContrast: { value: 1.18 }, uSat: { value: 1.22 }, uWarm: { value: 0.07 }, uVig: { value: 0.22 }, uNight: { value: 0 }, uExp: { value: 1.0 }, uSunUv: { value: new THREE.Vector3(0.5, 0.5, 0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast, uSat, uWarm, uVig, uNight, uExp; uniform vec3 uSunUv; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExp;
      // sun glare: a warm veil that grows as you look towards the sun, plus a faint lens streak
      if (uSunUv.z > 0.5) {
        vec2 d = (vUv - uSunUv.xy) * vec2(1.7, 1.0);
        float r = length(d);
        float veil = exp(-r * 18.0) * 0.025 + exp(-r * 40.0) * 0.08;
        float streak = exp(-abs(d.y) * 220.0) * exp(-abs(d.x) * 7.0) * 0.12;
        c += vec3(1.0, 0.86, 0.62) * (veil + streak) * (1.0 - uNight);
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // contrast about a mid-grey in linear light (pivot 0.18), keeps highlights from clipping because tone mapping follows
      c = max(vec3(0.0), (c - 0.35) * uContrast + 0.35);
      // split toning: warm highlights, cool shadows
      float hi = smoothstep(0.25, 1.4, l), lo = 1.0 - smoothstep(0.0, 0.35, l);
      c *= mix(vec3(1.0), vec3(1.0 + uWarm, 1.0 + uWarm * 0.45, 1.0 - uWarm * 0.9), hi);
      c *= mix(vec3(1.0), vec3(1.0 - 0.05, 1.0 - 0.01, 1.0 + 0.08), lo * (1.0 - uNight));
      // saturation
      float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(g), c, uSat);
      // vignette
      vec2 d = vUv - 0.5; float v = 1.0 - uVig * smoothstep(0.35, 0.85, length(d) * 1.25);
      gl_FragColor = vec4(c * v, 1.0);
    }`,
};

export class Grade {
  readonly composer: EffectComposer;
  private pass: ShaderPass;
  private ao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    // ambient occlusion: contact darkening where surfaces meet (under the aircraft, between buildings, in tree canopies)
    if (!new URLSearchParams(location.search).has('noao')) {
      const ao = new GTAOPass(scene, camera, size.x * pr, size.y * pr);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.0, thickness: 2.0, scale: 1.0, samples: 16 });
      ao.blendIntensity = 0.7;
      this.ao = ao;
      this.composer.addPass(ao);
    }
    // bloom: the sun and bright highlights bleed light, as a camera does
    if (!new URLSearchParams(location.search).has('nobloom')) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.05, 0.3, 1.6);
      this.composer.addPass(this.bloom);
    }
    this.pass = new ShaderPass(GradeShader);
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
  }
  /** Effects budget: 'min' = grading only, 'mid' = + bloom, 'full' = + ambient occlusion. */
  setQuality(fx: 'min' | 'mid' | 'full') { if (this.ao) this.ao.enabled = fx === 'full'; if (this.bloom) this.bloom.enabled = fx !== 'min'; }
  setCamera(camera: THREE.Camera) { (this.composer.passes[0] as RenderPass).camera = camera; if (this.ao) this.ao.camera = camera as THREE.PerspectiveCamera; }
  setSize(w: number, h: number) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  set(night: number, strength = 1, sunUv?: THREE.Vector3) {
    const u = this.pass.uniforms;
    if (sunUv) (u.uSunUv.value as THREE.Vector3).copy(sunUv);
    u.uExp.value = 1.0 - 0.2 * night;
    u.uNight.value = night;
    u.uContrast.value = 1 + 0.07 * strength; u.uSat.value = 1 + 0.28 * strength; u.uWarm.value = 0.07 * strength; u.uVig.value = 0.22 * strength;
  }
  render() { this.composer.render(); }
}
