// Cinematic colour grading for the whole frame: HDR render -> grade (contrast, saturation, warm highlights / cool shadows,
// soft vignette, slight bloom-like highlight lift) -> ACES tone mapping and sRGB. Replaces the plain "render straight to screen".

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uContrast: { value: 1.18 }, uSat: { value: 1.22 }, uWarm: { value: 0.07 }, uVig: { value: 0.22 }, uNight: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast, uSat, uWarm, uVig, uNight; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
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
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(GradeShader);
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
  }
  setCamera(camera: THREE.Camera) { (this.composer.passes[0] as RenderPass).camera = camera; }
  setSize(w: number, h: number) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  set(night: number, strength = 1) {
    const u = this.pass.uniforms;
    u.uNight.value = night;
    u.uContrast.value = 1 + 0.07 * strength; u.uSat.value = 1 + 0.28 * strength; u.uWarm.value = 0.07 * strength; u.uVig.value = 0.22 * strength;
  }
  render() { this.composer.render(); }
}
