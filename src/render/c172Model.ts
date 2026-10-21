// Original procedural Cessna 172 exterior model (no third-party assets).
// Authored in the flight model's body frame (FRD: x forward, y right, z down), origin at
// the reference datum, so control surfaces, gear and propeller are driven directly from
// the simulation state.

import * as THREE from 'three';
import { Aircraft } from '../sim/fdm/aircraft';
import { FlightControls } from '../sim/controls';

// --- shared materials
const paint = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f7, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, vertexColors: true });
const paintPlain = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f7, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 });
const navy = new THREE.MeshPhysicalMaterial({ color: 0x14254a, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x1c2630, roughness: 0.04, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.82 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
const propMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.3 });
const propTip = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5 });

const NAVY = new THREE.Color(0x14254a);
const BLUE = new THREE.Color(0x2f6fd6);
const WHITE = new THREE.Color(0xf4f5f7);

/** NACA 4-digit airfoil, returns closed loop of [x/c, z/c(up positive)] from TE over upper to LE and back. */
export function naca(m: number, p: number, t: number, n = 24): [number, number][] {
  const up: [number, number][] = [], lo: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / n));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
    up.push([x, yc + yt]); lo.push([x, yc - yt]);
  }
  return [...up.reverse(), ...lo.slice(1)];
}

/** Section of an airfoil loop between chord fractions [a, b], closed with straight caps. */
export function airfoilPart(loop: [number, number][], a: number, b: number): [number, number][] {
  const n = loop.length;
  const half = (n - 1) / 2;
  const upper = loop.slice(0, half + 1).reverse(); // LE -> TE
  const lower = loop.slice(half); // LE -> TE
  const clip = (pts: [number, number][]) => {
    const out: [number, number][] = [];
    const at = (x: number) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        if ((x0 - x) * (x1 - x) <= 0 && x1 !== x0) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
      }
      return pts[pts.length - 1][1];
    };
    out.push([a, at(a)]);
    for (const p of pts) if (p[0] > a && p[0] < b) out.push(p);
    out.push([b, at(b)]);
    return out;
  };
  const u = clip(upper), l = clip(lower);
  // loop: upper TE->LE, lower LE->TE
  return [...u.reverse(), ...l];
}

/**
 * Lofts a section between two spanwise stations. Each station: leading edge (x, y, z) in
 * FRD, chord, incidence (rad). `profile` is in chord fractions; `hinge` shifts the origin.
 */
export function loftWing(profile: [number, number][], stations: { le: THREE.Vector3; chord: number; inc: number }[], hingeX = 0) {
  const pos: number[] = [], idx: number[] = [];
  const m = profile.length;
  for (const s of stations) {
    for (const [xc, zc] of profile) {
      const px = -(xc - hingeX) * s.chord; // chord runs aft (-x)
      const pz = -zc * s.chord; // up = -z
      const ci = Math.cos(s.inc), si = Math.sin(s.inc);
      // incidence: rotate nose-up about y (trailing edge down)
      pos.push(s.le.x + px * ci + pz * si, s.le.y, s.le.z - px * si + pz * ci);
    }
  }
  for (let i = 0; i + 1 < stations.length; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j, b = i * m + ((j + 1) % m), c = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  const cap = (st: number, flip: boolean) => {
    const base = pos.length / 3;
    const s = st * m;
    for (let j = 0; j < m; j++) pos.push(pos[(s + j) * 3], pos[(s + j) * 3 + 1], pos[(s + j) * 3 + 2]);
    for (let j = 1; j + 1 < m; j++) flip ? idx.push(base, base + j + 1, base + j) : idx.push(base, base + j, base + j + 1);
  };
  cap(0, false); cap(stations.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ensures outward normals by checking against the centroid; flips winding if needed. */
export function orient(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const c = new THREE.Vector3(); g.boundingBox!.getCenter(c);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  if (dot < 0) {
    const idx = g.getIndex()!.array as unknown as number[];
    const a = Array.from(idx);
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.setIndex(a);
    g.computeVertexNormals();
  }
  return g;
}

// fuselage stations: x, half-width, top z, bottom z (FRD, up = -z)
const FUS: [number, number, number, number][] = [
  [2.42, 0.13, -0.36, -0.12], [2.25, 0.40, -0.55, 0.12], [2.0, 0.47, -0.6, 0.27], [1.6, 0.53, -0.64, 0.38],
  [1.35, 0.56, -0.68, 0.43], [1.05, 0.575, -0.9, 0.46], [0.75, 0.58, -0.99, 0.47], [0.3, 0.58, -1.0, 0.47],
  [-0.2, 0.575, -1.0, 0.46], [-0.75, 0.54, -0.96, 0.41], [-1.3, 0.47, -0.84, 0.33], [-2.0, 0.37, -0.68, 0.24],
  [-2.8, 0.28, -0.54, 0.16], [-3.6, 0.2, -0.44, 0.1], [-4.4, 0.13, -0.38, 0.05], [-5.1, 0.07, -0.33, 0.01],
  [-5.45, 0.03, -0.3, -0.02],
];

function fuselageAt(x: number): [number, number, number] {
  for (let i = 0; i + 1 < FUS.length; i++) {
    const [x0, w0, t0, b0] = FUS[i], [x1, w1, t1, b1] = FUS[i + 1];
    if (x <= x0 && x >= x1) {
      const t = (x0 - x) / (x0 - x1);
      const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
      return [w0 + (w1 - w0) * s, t0 + (t1 - t0) * s, b0 + (b1 - b0) * s];
    }
  }
  const l = FUS[FUS.length - 1];
  return [l[1], l[2], l[3]];
}

function buildFuselage() {
  const nx = 90, nr = 40;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const x0 = FUS[0][0], x1 = FUS[FUS.length - 1][0];
  const glassVerts: boolean[] = [];
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    const [hw, top, bot] = fuselageAt(x);
    const zc = (top + bot) / 2, hh = (bot - top) / 2;
    for (let j = 0; j < nr; j++) {
      const th = (j / nr) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const e = 2.6; // superellipse exponent (boxy cabin, rounded corners)
      const y = hw * Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
      const z = zc - hh * Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
      pos.push(x, y, z);
      // livery: navy cheat line with blue accent, white elsewhere; cabin windows dark
      const up = -z; // height above datum
      let color = WHITE;
      const isGlass = x < 1.25 && x > -0.95 && up > 0.58 && up < 0.97 && Math.abs(y) > 0.08 &&
        !(x < 0.42 && x > 0.33) && !(x < -0.35 && x > -0.43) && !(x > 1.02 && Math.abs(y) < 0.12);
      if (!isGlass) {
        const stripeTop = 0.05 + (x < -1.0 ? (-1.0 - x) * 0.07 : 0);
        if (up < stripeTop + 0.11 && up > stripeTop - 0.05 && x < 1.9) color = NAVY;
        else if (up < stripeTop - 0.05 && up > stripeTop - 0.11 && x < 1.9) color = BLUE;
      }
      glassVerts.push(isGlass);
      col.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nr; j++) {
    const a = i * nr + j, b = i * nr + ((j + 1) % nr), c = (i + 1) * nr + j, d = (i + 1) * nr + ((j + 1) % nr);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  orient(g);
  // glass as a separate slightly inflated shell limited to window triangles
  const gIdx: number[] = [];
  for (let k = 0; k < idx.length; k += 3) if (glassVerts[idx[k]] && glassVerts[idx[k + 1]] && glassVerts[idx[k + 2]]) gIdx.push(idx[k], idx[k + 1], idx[k + 2]);
  const gg = g.clone();
  gg.setIndex(orientedSubset(g, gIdx));
  gg.deleteAttribute('color');
  const p = gg.getAttribute('position'), n = gg.getAttribute('normal');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * 0.004, p.getY(i) + n.getY(i) * 0.004, p.getZ(i) + n.getZ(i) * 0.004);
  return { body: g, glass: gg };
}

function orientedSubset(g: THREE.BufferGeometry, subset: number[]) {
  // keep the winding used by g (orient() may have flipped it)
  const all = Array.from(g.getIndex()!.array);
  const set = new Set<string>();
  for (let k = 0; k < subset.length; k += 3) set.add([subset[k], subset[k + 1], subset[k + 2]].sort().join(','));
  const out: number[] = [];
  for (let k = 0; k < all.length; k += 3) if (set.has([all[k], all[k + 1], all[k + 2]].sort().join(','))) out.push(all[k], all[k + 1], all[k + 2]);
  return out;
}

function chordAt(y: number) { return y <= 2.6 ? 1.63 : 1.63 - ((y - 2.6) / (5.5 - 2.6)) * 0.5; }

export class C172Model {
  readonly root = new THREE.Group();
  /** Exterior parts hidden in the cockpit view. */
  readonly exterior = new THREE.Group();
  private flaps: THREE.Object3D[] = [];
  private ailL!: THREE.Object3D;
  private ailR!: THREE.Object3D;
  private elev: THREE.Object3D[] = [];
  private rudder!: THREE.Object3D;
  private prop = new THREE.Group();
  private blades = new THREE.Group();
  private propDisc: THREE.Mesh;
  private noseFork = new THREE.Group();
  private noseWheel!: THREE.Object3D;
  private mainWheels: THREE.Object3D[] = [];
  private gearParts: THREE.Object3D[] = [];
  private navR: THREE.PointLight; private navG: THREE.PointLight;
  private beaconMesh: THREE.Mesh; private strobeMeshes: THREE.Mesh[] = [];
  private navMeshes: THREE.Mesh[] = [];
  landingLight: THREE.SpotLight;
  private propAngle = 0;
  private t = 0;

  constructor() {
    this.root.name = 'C172';
    this.root.add(this.exterior);
    const { body, glass: glassGeo } = buildFuselage();
    const fus = new THREE.Mesh(body, paint);
    fus.castShadow = true; fus.receiveShadow = true;
    this.exterior.add(fus);
    this.exterior.add(new THREE.Mesh(glassGeo, glass));

    // --- wings
    const af = naca(0.02, 0.4, 0.12, 22);
    const dihedral = 1.73 * Math.PI / 180;
    const st = (y: number) => {
      const chord = chordAt(y);
      const inc = (1.5 - 3.0 * (y / 5.5)) * Math.PI / 180;
      const le = new THREE.Vector3(0.06 + 0.25 * chord, y, -1.0 - Math.abs(y) * Math.tan(dihedral));
      return { le, chord, inc };
    };
    for (const side of [-1, 1]) {
      const ys = [0.5, 1.2, 1.75, 2.2, 2.6, 2.95, 3.6, 4.2, 4.9, 5.5];
      const stations = ys.map((y) => { const s = st(y); s.le.y *= side; return s; });
      const main = orient(loftWing(airfoilPart(af, 0, 0.74), stations));
      const wm = new THREE.Mesh(main, paintPlain); wm.castShadow = true; wm.receiveShadow = true;
      this.exterior.add(wm);
      // wingtip fairing
      const tip = st(5.5); tip.le.y *= side;
      const tipGeo = new THREE.SphereGeometry(1, 16, 8);
      tipGeo.scale(tip.chord * 0.48, 0.12, 0.08);
      const tipM = new THREE.Mesh(tipGeo, paintPlain);
      tipM.position.set(tip.le.x - tip.chord * 0.48, tip.le.y + side * 0.02, tip.le.z + 0.02);
      this.exterior.add(tipM);
      // flaps (0.6 .. 2.95) and aileron (2.95 .. 5.3), hinged at 74 % chord
      const mkSurface = (y0: number, y1: number) => {
        const s0 = st(y0), s1 = st(y1);
        s0.le.y *= side; s1.le.y *= side;
        const hingeX = s0.le.x - 0.74 * s0.chord; // approx straight hinge line
        const hingeZ = s0.le.z + 0.0;
        const rel = [s0, s1].map((s) => ({ le: new THREE.Vector3(s.le.x - hingeX, s.le.y, s.le.z - hingeZ), chord: s.chord, inc: s.inc }));
        const geo = orient(loftWing(airfoilPart(af, 0.74, 1.0), rel));
        const pivot = new THREE.Group();
        pivot.position.set(hingeX, 0, hingeZ);
        const m = new THREE.Mesh(geo, paintPlain); m.castShadow = true;
        pivot.add(m);
        this.exterior.add(pivot);
        return pivot;
      };
      this.flaps.push(mkSurface(0.6, 2.95));
      const ail = mkSurface(2.95, 5.35);
      if (side < 0) this.ailL = ail; else this.ailR = ail;
      // wing strut
      const a = new THREE.Vector3(0.05, side * 2.55, -0.96), b = new THREE.Vector3(0.25, side * 0.56, 0.3);
      this.exterior.add(strut(a, b, 0.045, 0.02, paintPlain));
      // nav light + strobe at the wingtip
      const nl = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2020 : 0x20ff40 }));
      nl.position.set(tip.le.x - 0.05, side * 5.56, tip.le.z);
      this.exterior.add(nl); this.navMeshes.push(nl);
      const sm = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      sm.position.set(tip.le.x - 0.2, side * 5.57, tip.le.z);
      this.exterior.add(sm); this.strobeMeshes.push(sm);
    }

    // --- horizontal tail and elevators
    const tailAf = naca(0, 0.3, 0.09, 16);
    for (const side of [-1, 1]) {
      const stab = (y: number) => {
        const c = 1.1 - (Math.abs(y) / 1.72) * 0.35;
        return { le: new THREE.Vector3(-4.35 - (Math.abs(y) / 1.72) * 0.12, y * side, -0.2), chord: c, inc: 0 };
      };
      const ys = [0.12, 0.6, 1.2, 1.72];
      const main = orient(loftWing(airfoilPart(tailAf, 0, 0.58), ys.map(stab)));
      const sm = new THREE.Mesh(main, paintPlain); sm.castShadow = true;
      this.exterior.add(sm);
      const s0 = stab(0.15);
      const hingeX = s0.le.x - 0.58 * s0.chord;
      const rel = [0.15, 0.6, 1.2, 1.7].map((y) => { const s = stab(y); return { le: new THREE.Vector3(s.le.x - hingeX, s.le.y, s.le.z + 0.2), chord: s.chord, inc: 0 }; });
      const eg = orient(loftWing(airfoilPart(tailAf, 0.58, 1.0), rel));
      const pivot = new THREE.Group(); pivot.position.set(hingeX, 0, -0.2);
      const em = new THREE.Mesh(eg, paintPlain); em.castShadow = true;
      pivot.add(em);
      this.exterior.add(pivot);
      this.elev.push(pivot);
    }

    // --- fin and rudder (profile in x-z plane, thickness along y)
    const finSt = (h: number) => {
      // h: 0 at fuselage top (z -0.36) to 1 at fin tip (z -1.72)
      const z = -0.36 - h * 1.36;
      const le = -3.95 - h * 0.95;
      const chord = 1.45 - h * 0.62;
      return { le, z, chord };
    };
    const finProfile = (a: number, b: number) => airfoilPart(tailAf, a, b);
    const finGeo = (a: number, b: number, hingeX = 0) => {
      const prof = finProfile(a, b);
      const pos: number[] = [], idx: number[] = [];
      const hs = [0, 0.25, 0.5, 0.75, 1];
      for (const h of hs) {
        const f = finSt(h);
        for (const [xc, tc] of prof) pos.push(f.le - xc * f.chord - hingeX, tc * f.chord * 0.9, f.z);
      }
      const m = prof.length;
      for (let i = 0; i + 1 < hs.length; i++) for (let j = 0; j < m; j++) {
        const p0 = i * m + j, p1 = i * m + ((j + 1) % m), p2 = (i + 1) * m + j, p3 = (i + 1) * m + ((j + 1) % m);
        idx.push(p0, p2, p1, p1, p2, p3);
      }
      const base = pos.length / 3; const top = (hs.length - 1) * m;
      for (let j = 0; j < m; j++) pos.push(pos[(top + j) * 3], pos[(top + j) * 3 + 1], pos[(top + j) * 3 + 2]);
      for (let j = 1; j + 1 < m; j++) idx.push(base, base + j, base + j + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return orient(g);
    };
    const fin = new THREE.Mesh(finGeo(0, 0.62), paintPlain); fin.castShadow = true;
    this.exterior.add(fin);
    // dorsal fin
    const dorsal = new THREE.Shape([new THREE.Vector2(-2.5, 0.6), new THREE.Vector2(-4.0, 0.38), new THREE.Vector2(-4.0, 0.75)]);
    const dg = new THREE.ExtrudeGeometry(dorsal, { depth: 0.06, bevelEnabled: false });
    dg.rotateX(Math.PI / 2); dg.translate(0, 0.03, 0); dg.scale(1, 1, -1);
    const dorsalMat = paintPlain.clone(); dorsalMat.side = THREE.DoubleSide;
    this.exterior.add(new THREE.Mesh(dg, dorsalMat));
    // rudder hinge roughly at 62 % chord of the mid station
    const rh = finSt(0.5); const rudHx = rh.le - 0.62 * rh.chord;
    this.rudder = new THREE.Group();
    this.rudder.position.set(rudHx, 0, 0);
    const rm = new THREE.Mesh(finGeo(0.62, 1.0, rudHx), navy); rm.castShadow = true;
    this.rudder.add(rm);
    this.exterior.add(this.rudder);
    // beacon on the fin tip, nav light on the tail
    this.beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1a1a }));
    this.beaconMesh.position.set(-4.95, 0, -1.76);
    this.exterior.add(this.beaconMesh);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    tl.position.set(-5.5, 0, -0.3); this.exterior.add(tl); this.navMeshes.push(tl);

    // --- propeller and spinner
    this.prop.position.set(2.25, 0, -0.25);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.36, 24, 1), navy);
    spinner.rotation.z = -Math.PI / 2; spinner.position.x = 0.14;
    this.prop.add(spinner);
    for (const s of [-1, 1]) {
      const bladeGeo = new THREE.BoxGeometry(0.035, 0.9, 0.13, 1, 8, 1);
      const bp = bladeGeo.getAttribute('position');
      for (let i = 0; i < bp.count; i++) {
        const y = bp.getY(i) + 0.45; // 0..0.9
        const w = 1 - Math.pow(y / 0.9, 2) * 0.55; // taper
        const tw = (0.6 - y * 0.55); // twist
        const x = bp.getX(i), z = bp.getZ(i) * w;
        bp.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y + 0.06, x * Math.sin(tw) + z * Math.cos(tw));
      }
      bladeGeo.computeVertexNormals();
      const blade = new THREE.Mesh(bladeGeo, propMat);
      blade.castShadow = true;
      blade.rotation.x = s > 0 ? 0 : Math.PI;
      const tipM = new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.08, 0.08), propTip);
      tipM.position.y = 0.92; blade.add(tipM);
      this.blades.add(blade);
    }
    this.prop.add(this.blades);
    this.propDisc = new THREE.Mesh(new THREE.CircleGeometry(0.97, 48), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    this.propDisc.rotation.y = Math.PI / 2;
    this.prop.add(this.propDisc);
    this.exterior.add(this.prop);

    // --- landing gear
    const wheel = () => {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.065, 10, 24), rubber);
      tyre.rotation.x = Math.PI / 2;
      g.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16), metal);
      g.add(hub);
      return g;
    };
    const pant = () => {
      const geo = new THREE.SphereGeometry(1, 20, 12);
      geo.scale(0.42, 0.11, 0.19);
      const m = new THREE.Mesh(geo, paintPlain); m.castShadow = true;
      return m;
    };
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const w = wheel(); w.position.set(-0.45, side * 1.27, 0.8);
      const p = pant(); p.position.set(-0.43, side * 1.27, 0.76);
      g.add(w, p);
      const leg = strut(new THREE.Vector3(-0.45, side * 0.48, 0.42), new THREE.Vector3(-0.45, side * 1.2, 0.78), 0.035, 0.035, paintPlain);
      g.add(leg);
      this.exterior.add(g);
      this.mainWheels.push(w);
      this.gearParts.push(g);
    }
    const nose = new THREE.Group();
    const noseStrut = strut(new THREE.Vector3(1.2, 0, 0.25), new THREE.Vector3(1.2, 0, 0.68), 0.04, 0.04, metal);
    nose.add(noseStrut);
    this.noseFork.position.set(1.2, 0, 0.6);
    const nw = wheel(); nw.position.set(-0.03, 0, 0.2); nw.scale.setScalar(0.92);
    const np = pant(); np.position.set(-0.01, 0, 0.17); np.scale.set(0.85, 0.9, 0.9);
    this.noseFork.add(nw, np);
    this.noseWheel = nw;
    nose.add(this.noseFork);
    this.exterior.add(nose);
    this.gearParts.push(nose);

    // --- lights
    this.navR = new THREE.PointLight(0xff2020, 0, 6, 2); this.navR.position.set(-0.2, -5.6, -1.17);
    this.navG = new THREE.PointLight(0x20ff40, 0, 6, 2); this.navG.position.set(-0.2, 5.6, -1.17);
    this.root.add(this.navR, this.navG);
    this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 900, 0.22, 0.4, 1.6);
    this.landingLight.position.set(0.5, -2.0, -1.0);
    this.landingLight.target.position.set(60, -2.0, 4.0);
    this.root.add(this.landingLight, this.landingLight.target);

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.castShadow || false; });
  }

  /** Update moving parts from the simulation. */
  update(ac: Aircraft, c: FlightControls, dt: number, night: number) {
    this.t += dt;
    // positive deflection = trailing edge toward -normal: +rotation about body y (TE down)
    for (const f of this.flaps) f.rotation.y = ac.flap;
    this.ailL.rotation.y = ac.aileronL;
    this.ailR.rotation.y = ac.aileronR;
    for (const e of this.elev) e.rotation.y = ac.elevator;
    // rudder: positive = trailing edge to the left (-y): +rotation about body z
    this.rudder.rotation.z = ac.rudder;
    const omega = (ac.engine.rpm / 60) * Math.PI * 2;
    this.propAngle += omega * dt;
    this.prop.rotation.x = this.propAngle;
    const blur = THREE.MathUtils.clamp((ac.engine.rpm - 400) / 900, 0, 1);
    (this.propDisc.material as THREE.MeshBasicMaterial).opacity = 0.18 * blur;
    this.blades.visible = blur < 0.98 || Math.floor(this.t * 60) % 3 === 0;
    // gear compression and wheel rotation
    const gs = ac.gearStates;
    const noseComp = gs[0]?.compression ?? 0;
    this.noseFork.position.z = 0.6 - noseComp;
    this.noseFork.rotation.z = gs[0]?.steer ?? 0;
    this.noseWheel.rotation.y = -(gs[0]?.wheelAngle ?? 0);
    for (let i = 0; i < 2; i++) {
      const s = gs[i + 1];
      this.gearParts[i].position.z = -(s?.compression ?? 0) * 0.8;
      this.mainWheels[i].rotation.y = -(s?.wheelAngle ?? 0);
    }
    // lights
    const navOn = c.navLights && c.masterBattery;
    this.navR.intensity = navOn ? 2 * night : 0;
    this.navG.intensity = navOn ? 2 * night : 0;
    for (const m of this.navMeshes) m.visible = navOn;
    const beacon = c.beacon && c.masterBattery && (this.t % 1.2) < 0.12;
    this.beaconMesh.visible = beacon;
    const strobe = c.strobes && c.masterBattery && ((this.t % 1.1) < 0.05 || ((this.t + 0.12) % 1.1) < 0.05);
    for (const m of this.strobeMeshes) { m.visible = strobe; m.scale.setScalar(strobe ? 3 : 1); }
    this.landingLight.intensity = (c.landingLight || c.taxiLight) && c.masterBattery ? 4000 * (0.3 + night) : 0;
  }

  setCockpitView(inCockpit: boolean) {
    // inside the cabin hide the fuselage shell (the interior model replaces it)
    this.exterior.children[0].visible = !inCockpit;
    this.exterior.children[1].visible = !inCockpit;
  }
}

/** Tapered elliptical strut between two points. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, 10);
  g.scale(1, 1, 0.45);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}
