// Airliner visuals from the converted packs in public/models/airliners (tools/airliners/convert.mjs): body-frame geometry (x nose, y right, z down, metres),
// one mesh per material. Static (no moving surfaces or gear animation). Models: "A350 V5" by Newbie99999993, "Lufthansa Airbus A340-600" by Dave Love
// SketchFab and "Airbus A320-200" by Dlourine, all CC BY 4.0.
import * as THREE from 'three';

interface MatMeta { name: string; map: string; color: number[]; opacity: number; metal: number; rough: number; n: number; ni: number; pos: number; nrm: number; uv: number; idx: number }

export async function buildPack(base: string, id: string, doubleSided = false): Promise<THREE.Group> {
  const out = new THREE.Group();
    const [meta, bin] = await Promise.all([fetch(base + id + '.json').then((r) => r.json()), fetch(base + id + '.bin').then((r) => r.arrayBuffer())]);
    const tl = new THREE.TextureLoader(), texs = new Map<string, THREE.Texture>();
    const tex = (n: string) => { let t = texs.get(n); if (!t) { t = tl.load(base + n); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; texs.set(n, t); } return t; };
    for (const m of meta.materials as MatMeta[]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, m.pos, m.n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, m.nrm, m.n * 3), 3, true));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, m.uv, m.n * 2), 2));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, m.idx, m.ni), 1));
      g.computeBoundingSphere();
      const glass = m.opacity < 0.98;
      const mat = new THREE.MeshStandardMaterial({
        map: m.map ? tex(m.map) : null, color: m.map ? 0xffffff : new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2], THREE.LinearSRGBColorSpace),
        metalness: Math.min(m.metal, 0.4), roughness: Math.max(m.rough, 0.35), transparent: glass, opacity: glass ? Math.max(0.35, m.opacity) : 1, side: glass || doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = !glass; mesh.receiveShadow = true;
      out.add(mesh);
    }
    return out;
}

export class AirlinerModel {
  readonly root = new THREE.Group();
  landingLight = new THREE.SpotLight(0xffffff, 0);
  private body = new THREE.Group();
  constructor(private id: string) { this.root.name = 'airliner ' + id; this.root.add(this.body); this.landingLight.visible = false; this.root.add(this.landingLight, this.landingLight.target); }

  async load(base = './models/airliners/') { this.body.add(await buildPack(base, this.id)); }

  update(_ac: unknown, _c: unknown, _dt: number, _night: number) { /* static model */ }
  setCockpitView(inCockpit: boolean) { this.body.visible = !inCockpit; }
}

/** No flight-deck model for these airliners: the cockpit view is an outside view from the pilot's eye with the airframe hidden. */
export class AirlinerCockpit {
  readonly root = new THREE.Group(); private started = false;
  /** the flight deck is only fetched when the cockpit view is first used; only the A320 has one (the supplied deck, airframe cut away) */
  constructor(private id = '') {}
  update(_dt: number, _night: number) {
    if (this.started || this.id !== 'a320') return;
    this.started = true;
    buildPack('./models/airliners/', 'a320_cockpit', true).then((g) => this.root.add(g)).catch((e) => console.warn('A320 flight deck not loaded', e));
  }
}
