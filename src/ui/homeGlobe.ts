// The Earth on the menu's home screen: a slowly turning globe whose land/sea map is drawn from simplified continent outlines (no image files),
// with a blue atmosphere rim and a sun-lit side, over a star field. Only renders while the home screen is visible.
import * as THREE from 'three';

type Ring = [number, number][];   // [lon, lat]
const LAND: Ring[] = [
  // North America
  [[-168, 66], [-160, 71], [-140, 70], [-125, 70], [-95, 72], [-82, 68], [-65, 62], [-56, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-83, 29], [-90, 30], [-97, 27], [-97, 21], [-90, 21], [-87, 21], [-88, 15], [-83, 10], [-79, 9], [-83, 8], [-92, 14], [-105, 20], [-110, 24], [-112, 29], [-115, 31], [-110, 23], [-117, 32], [-124, 40], [-124, 48], [-130, 55], [-140, 60], [-150, 60], [-165, 55], [-160, 58]],
  // Greenland
  [[-73, 78], [-60, 82], [-30, 83], [-20, 75], [-22, 70], [-40, 65], [-44, 60], [-52, 64], [-58, 75]],
  // South America
  [[-80, 9], [-72, 12], [-62, 10], [-52, 5], [-50, 0], [-35, -6], [-39, -14], [-41, -22], [-48, -26], [-58, -35], [-57, -38], [-65, -41], [-66, -47], [-69, -52], [-72, -54], [-75, -48], [-73, -38], [-71, -30], [-70, -18], [-76, -14], [-81, -5], [-80, 0], [-77, 6]],
  // Eurasia
  [[-9, 37], [-9, 43], [-2, 44], [-4, 48], [2, 51], [8, 54], [8, 57], [10, 57], [12, 54], [20, 55], [23, 59], [30, 60], [22, 65], [17, 69], [25, 71], [40, 68], [60, 70], [80, 73], [100, 77], [115, 74], [140, 72], [160, 70], [180, 68], [180, 65], [170, 60], [160, 55], [156, 51], [142, 52], [140, 47], [132, 43], [128, 39], [126, 35], [122, 38], [121, 31], [119, 25], [110, 21], [107, 17], [108, 11], [104, 9], [101, 13], [100, 7], [104, 2], [98, 10], [94, 17], [90, 22], [86, 20], [80, 15], [78, 8], [73, 17], [72, 21], [67, 25], [60, 25], [57, 25], [56, 27], [50, 30], [48, 30], [52, 24], [56, 24], [59, 22], [52, 16], [44, 12], [42, 16], [35, 28], [34, 31], [36, 36], [30, 36], [26, 38], [27, 41], [23, 40], [19, 41], [19, 45], [13, 45], [16, 38], [12, 38], [9, 44], [3, 43], [-1, 38], [-5, 36]],
  // Africa
  [[-17, 21], [-10, 30], [-6, 36], [10, 37], [20, 33], [32, 31], [34, 28], [43, 12], [51, 12], [40, -3], [41, -15], [35, -24], [32, -29], [27, -34], [19, -35], [15, -27], [12, -17], [13, -8], [9, -1], [9, 4], [-8, 4], [-17, 14]],
  // Australia
  [[114, -22], [122, -18], [130, -12], [137, -12], [141, -11], [146, -19], [153, -26], [150, -37], [141, -38], [135, -34], [130, -32], [116, -35], [114, -26]],
  // British Isles, Japan, Indonesia, Madagascar, New Zealand, Iceland (small shapes)
  [[-5, 50], [1, 51], [2, 53], [-1, 56], [-2, 58], [-5, 58], [-6, 56], [-3, 54], [-5, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-10, 54]],
  [[130, 31], [135, 34], [140, 36], [142, 40], [141, 45], [138, 38], [132, 34]],
  [[95, 5], [104, -2], [106, -6], [100, -2], [96, 2]],
  [[109, 1], [118, 5], [118, -3], [110, -3]],
  [[131, -1], [141, -3], [150, -9], [141, -9], [133, -4]],
  [[44, -25], [50, -15], [48, -13], [43, -17]],
  [[172, -34], [178, -38], [175, -41], [171, -45], [167, -46], [172, -41]],
  [[-24, 65], [-14, 66], [-14, 64], [-22, 63]],
];

function makeEarthTexture(): THREE.CanvasTexture {
  const W = 2048, H = 1024, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const X = (lon: number) => ((lon + 180) / 360) * W, Y = (lat: number) => ((90 - lat) / 180) * H;
  g.fillStyle = '#0e3a70'; g.fillRect(0, 0, W, H);
  // shallow-water halo around the land
  g.save(); g.filter = 'blur(10px)'; g.fillStyle = '#1b5f8f';
  for (const r of LAND) { g.beginPath(); r.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la)))); g.closePath(); g.lineWidth = 22; g.strokeStyle = '#1b5f8f'; g.stroke(); g.fill(); }
  g.restore();
  // land, coloured by latitude (desert belt, tropics, temperate, tundra)
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#dfe6e8'); grad.addColorStop(0.1, '#7d8a68'); grad.addColorStop(0.22, '#476a3a'); grad.addColorStop(0.33, '#6b7c45'); grad.addColorStop(0.4, '#a78e58');
  grad.addColorStop(0.5, '#2f6a2d'); grad.addColorStop(0.6, '#3f6f33'); grad.addColorStop(0.7, '#a08b5a'); grad.addColorStop(0.8, '#5d7a45'); grad.addColorStop(1, '#dfe6e8');
  g.fillStyle = grad;
  for (const r of LAND) { g.beginPath(); r.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la)))); g.closePath(); g.fill(); }
  // mottling so the land is not flat (seeded blobs clipped to the land)
  g.save(); g.beginPath(); for (const r of LAND) { r.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la)))); g.closePath(); } g.clip();
  let sd = 7; const rnd = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1400; i++) { const x = rnd() * W, y = rnd() * H, r = 6 + rnd() * 34; g.fillStyle = `rgba(${rnd() < 0.5 ? '20,50,20' : '170,150,100'},${0.05 + rnd() * 0.09})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
  // polar ice
  g.fillStyle = '#eef3f5'; g.fillRect(0, 0, W, Y(81)); g.fillRect(0, Y(-70), W, H - Y(-70));
  // clouds: many small soft blobs in bands (more in the tropics and mid-latitudes)
  for (let i = 0; i < 900; i++) {
    const lat = (rnd() < 0.55 ? (rnd() - 0.5) * 50 : (rnd() < 0.5 ? 1 : -1) * (35 + rnd() * 30)), x = rnd() * W, y = Y(lat), r = 8 + rnd() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.6); gr.addColorStop(0, `rgba(255,255,255,${0.16 + rnd() * 0.14})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 2.2, r * 0.8, rnd() * 0.4 - 0.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class HomeGlobe {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private earth!: THREE.Mesh;
  private raf = 0; private last = 0; private running = false;

  constructor() {
    this.canvas.className = 'jv-globe';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    } catch { this.renderer = null; return; }   // no WebGL: the menu just has no globe
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map: makeEarthTexture(), roughness: 0.85, metalness: 0 }));
    this.earth.rotation.set(0.32, 5.45, 0);   // the Americas face the viewer first
    this.scene.add(this.earth);
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1.028, 64, 48), new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vP; void main(){ float f = pow(clamp(0.64 - dot(vN, normalize(-vP)), 0.0, 1.0), 3.5); gl_FragColor = vec4(0.30, 0.58, 1.0, 1.0) * f * 1.5; }',
    }));
    this.scene.add(atm);
    const sun = new THREE.DirectionalLight(0xfff4e0, 3.6); sun.position.set(2.6, 1.0, 3.0); this.scene.add(sun, new THREE.AmbientLight(0x5575a5, 0.7));
    this.camera.position.set(0, 0, 4.6);
  }

  private resize() {
    const r = this.renderer!, p = this.canvas.parentElement; if (!p) return;
    const w = p.clientWidth, h = p.clientHeight; if (!w || !h) return;
    r.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  start() {
    if (!this.renderer || this.running) return;
    this.running = true; this.last = performance.now(); this.resize();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.1); this.last = now;
      this.earth.rotation.y += dt * 0.035;
      if (this.canvas.clientWidth && Math.abs(this.renderer!.domElement.width - this.canvas.clientWidth * this.renderer!.getPixelRatio()) > 2) this.resize();
      this.renderer!.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}
