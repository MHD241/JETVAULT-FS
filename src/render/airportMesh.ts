// Airport rendering from real data: runway with ICAO markings, taxiway/apron pavement
// (painted into the terrain overlay so it lies exactly on the physics surface), taxiway
// centrelines, runway/taxiway lighting and an optically correct PAPI.

import * as THREE from 'three';
import { AirportData, Runway, TAXIWAY_HALF_WIDTH } from '../world/airport';
import { Terrain } from '../world/terrain';
import { TerrainOverlay } from './terrainMesh';

const OVERLAY_PX = 4096;

export function buildPavementOverlay(ap: AirportData): TerrainOverlay {
  // square around all paved features
  const xs: number[] = [], ys: number[] = [];
  for (const t of ap.taxiways) for (const [x, y] of t) { xs.push(x); ys.push(y); }
  for (const a of ap.aprons) for (const [x, y] of a) { xs.push(x); ys.push(y); }
  for (const r of ap.runways) for (const e of r.ends) { xs.push(e.x); ys.push(e.y); }
  const minX = Math.min(...xs) - 150, maxX = Math.max(...xs) + 150;
  const minY = Math.min(...ys) - 150, maxY = Math.max(...ys) + 150;
  const size = Math.max(maxX - minX, maxY - minY);
  const e0 = (minX + maxX) / 2 - size / 2, n0 = (minY + maxY) / 2 - size / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = OVERLAY_PX;
  const g = cv.getContext('2d')!;
  const k = OVERLAY_PX / size;
  const P = (x: number, y: number): [number, number] => [(x - e0) * k, OVERLAY_PX - (y - n0) * k];
  g.clearRect(0, 0, OVERLAY_PX, OVERLAY_PX);
  // aprons: concrete
  g.fillStyle = 'rgb(128,126,120)';
  for (const a of ap.aprons) {
    g.beginPath();
    a.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath(); g.fill();
  }
  // taxiways: asphalt with shoulders
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [w, col] of [[TAXIWAY_HALF_WIDTH * 2 + 7, 'rgb(118,116,108)'], [TAXIWAY_HALF_WIDTH * 2, 'rgb(84,84,82)']] as const) {
    g.strokeStyle = col; g.lineWidth = w * k;
    for (const t of ap.taxiways) {
      g.beginPath();
      t.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
    }
  }
  // runway strip underneath the runway mesh (avoids grass showing at the edges)
  for (const rw of ap.runways) {
    const [a, b] = rw.ends;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    g.strokeStyle = 'rgb(80,80,78)'; g.lineWidth = (rw.width + 6) * k; g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(...P(a.x - ux * 60, a.y - uy * 60)); g.lineTo(...P(b.x + ux * 60, b.y + uy * 60));
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; // converted to linear in the shader
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: tex, e0, n0, size };
}

/** Road network overlay (Overture/OSM road segments) around the airport. */
export function buildRoadOverlay(roads: [string, [number, number][]][]): TerrainOverlay {
  const size = 18000, e0 = -9000, n0 = -9000, px = 4096;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d')!;
  const k = px / size;
  const width: Record<string, number> = { motorway: 24, trunk: 18, primary: 13, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6, living_street: 5, service: 4.5 };
  const order = ['service', 'living_street', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const cls of order) {
    g.strokeStyle = cls === 'motorway' || cls === 'trunk' ? 'rgb(70,71,73)' : 'rgb(88,88,88)';
    g.lineWidth = Math.max(1, width[cls] * k);
    g.beginPath();
    for (const [c, pts] of roads) {
      if (c !== cls) continue;
      pts.forEach(([x, y], i) => { const X = (x - e0) * k, Y = px - (y - n0) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return { texture: tex, e0, n0, size };
}

/** Runway markings texture in runway coordinates (u across, v along from end[0]). */
function runwayTexture(rw: Runway) {
  const W = 512, H = 4096;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const mx = W / rw.width; // px per metre across
  const my = H / rw.length; // px per metre along
  // asphalt with subtle wear
  g.fillStyle = 'rgb(58,58,58)';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 6);
  }
  // tyre rubber deposits in touchdown zones
  const rubber = (from: number) => {
    const grd = g.createLinearGradient(0, from * my, 0, (from + 500) * my);
    grd.addColorStop(0, 'rgba(15,15,15,0)'); grd.addColorStop(0.3, 'rgba(15,15,15,0.55)'); grd.addColorStop(1, 'rgba(15,15,15,0)');
    g.fillStyle = grd;
    g.fillRect(W * 0.3, from * my, W * 0.4, 500 * my);
  };
  const white = 'rgb(232,232,228)';
  // v measured from end[0]; draw each end in its own direction
  const drawEnd = (ident: string, displaced: number, flip: boolean) => {
    const V = (m: number) => (flip ? H - m * my : m * my); // metres from this end -> px
    const rect = (u0: number, m0: number, wu: number, lm: number) => {
      const y0 = V(m0), y1 = V(m0 + lm);
      g.fillRect(u0 * mx, Math.min(y0, y1), wu * mx, Math.abs(y1 - y0));
    };
    rubber(flip ? rw.length - displaced - 750 : displaced + 250);
    g.fillStyle = white;
    // displaced threshold: arrows on centreline and transverse bar
    if (displaced > 5) {
      for (let m = 20; m < displaced - 20; m += 50) {
        rect(rw.width / 2 - 0.45, m, 0.9, 25);
        // arrow head
        const yTip = V(m + 30), yBase = V(m + 22);
        g.beginPath(); g.moveTo((rw.width / 2) * mx, yTip); g.lineTo((rw.width / 2 - 2) * mx, yBase); g.lineTo((rw.width / 2 + 2) * mx, yBase); g.closePath(); g.fill();
      }
      rect(0.5, displaced - 1.8, rw.width - 1, 1.8);
    }
    // threshold piano keys: 12 stripes (1.8 m) for a 45 m runway, wider centre gap
    for (let i = 0; i < 6; i++) {
      rect(2.0 + i * 3.4, displaced + 6, 1.8, 30);
      rect(rw.width - 3.8 - i * 3.4, displaced + 6, 1.8, 30);
    }
    // designator
    g.save();
    const yNum = V(displaced + 48);
    g.translate((rw.width / 2) * mx, yNum);
    if (!flip) g.rotate(Math.PI);
    g.scale(mx, my);
    g.font = 'bold 9px Arial';
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(ident.padStart(2, '0').split('').join(' '), 0, 0, 12);
    g.restore();
    // touchdown zone markings (pairs) at 150 m intervals and aiming point at 400 m
    for (const [m, bars] of [[150, 3], [300, 3], [450, 2], [600, 2], [750, 1], [900, 1]] as const) {
      for (let b = 0; b < bars; b++) {
        rect(rw.width / 2 - 4 - b * 1.6 - 1.2, displaced + m, 1.2, 22.5);
        rect(rw.width / 2 + 4 + b * 1.6, displaced + m, 1.2, 22.5);
      }
    }
    rect(rw.width / 2 - 9 - 6, displaced + 400, 6, 50);
    rect(rw.width / 2 + 9, displaced + 400, 6, 50);
  };
  drawEnd(rw.ends[0].ident, rw.ends[0].displaced, false);
  drawEnd(rw.ends[1].ident, rw.ends[1].displaced, true);
  g.fillStyle = white;
  // centreline 30 m stripes, 20 m gaps
  for (let m = rw.ends[0].displaced + 100; m < rw.length - rw.ends[1].displaced - 100; m += 50) {
    g.fillRect((rw.width / 2 - 0.45) * mx, m * my, 0.9 * mx, 30 * my);
  }
  // edge lines
  g.fillRect(0.4 * mx, 0, 0.9 * mx, H);
  g.fillRect((rw.width - 1.3) * mx, 0, 0.9 * mx, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.flipY = false; // canvas row 0 = runway end[0] (uv.y = 0)
  return tex;
}

export interface PapiUnit { pos: THREE.Vector3; angle: number; light: number }

export class AirportRenderer {
  readonly group = new THREE.Group();
  private lightMat: THREE.ShaderMaterial;
  private papi: { units: PapiUnit[]; colors: THREE.BufferAttribute; points: THREE.Points }[] = [];
  /** 0 = lights off (day), 1 = full intensity (night / low visibility). */
  lightLevel = 0;

  constructor(private ap: AirportData, private terrain: Terrain) {
    this.group.name = 'airport';
    this.lightMat = new THREE.ShaderMaterial({
      uniforms: { uLevel: { value: 1 }, uScale: { value: 1 } },
      vertexShader: `
        attribute vec3 color; attribute float size; attribute float always;
        uniform float uLevel; uniform float uScale;
        varying vec3 vColor; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          float lvl = max(uLevel, always);
          vA = lvl;
          vColor = color;
          gl_PointSize = clamp(size * uScale * 900.0 / max(d, 1.0), 1.5, 24.0) * (0.35 + 0.65 * lvl);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vA;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float r = length(p);
          float core = smoothstep(0.5, 0.0, r);
          float glow = exp(-r * r * 18.0);
          float a = (core * 0.6 + glow) * vA;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * (1.0 + 2.0 * glow), a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (const rw of ap.runways) this.buildRunway(rw);
    this.buildTaxiwayLines();
    this.buildLights();
  }

  private h(e: number, n: number) { return this.terrain.heightAt(e, n); }

  private buildRunway(rw: Runway) {
    const [a, b] = rw.ends;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L, px = uy, py = -ux; // right-hand perpendicular
    const seg = Math.ceil(L / 10);
    const across = [0, 0.25, 0.5, 0.75, 1];
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      for (const s of across) {
        const off = (s - 0.5) * rw.width;
        const e = a.x + ux * L * t + px * off, n = a.y + uy * L * t + py * off;
        pos.push(e, this.h(e, n) + 0.04, -n);
        uv.push(1 - s, t);
      }
    }
    const m = across.length;
    for (let i = 0; i < seg; i++) for (let j = 0; j < m - 1; j++) {
      const p0 = i * m + j, p1 = p0 + 1, p2 = p0 + m, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure faces point up regardless of runway direction
    const nrm = g.getAttribute('normal');
    if (nrm.getY(0) < 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
    const mat = new THREE.MeshStandardMaterial({
      map: runwayTexture(rw), roughness: 0.85, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = `runway ${rw.id}`;
    this.group.add(mesh);
  }

  private buildTaxiwayLines() {
    const pos: number[] = [], idx: number[] = [];
    const w = 0.15;
    for (const line of this.ap.taxiways) {
      // resample every 4 m so the line follows the terrain
      const pts: [number, number][] = [];
      for (let i = 0; i + 1 < line.length; i++) {
        const [x0, y0] = line[i], [x1, y1] = line[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(L / 4));
        for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
      }
      pts.push(line[line.length - 1]);
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i];
        const [xa, ya] = pts[Math.max(0, i - 1)], [xb, yb] = pts[Math.min(pts.length - 1, i + 1)];
        const dx = xb - xa, dy = yb - ya, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * w, ny = dx / L * w;
        pos.push(x + nx, this.h(x + nx, y + ny) + 0.05, -(y + ny));
        pos.push(x - nx, this.h(x - nx, y - ny) + 0.05, -(y - ny));
        if (i > 0) {
          const p = base + (i - 1) * 2;
          idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd8a920, roughness: 0.7, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'taxiway centrelines';
    this.group.add(mesh);
  }

  private buildLights() {
    const pos: number[] = [], col: number[] = [], size: number[] = [], always: number[] = [];
    const add = (e: number, n: number, c: [number, number, number], s = 1, alw = 0, hgt = 0.35) => {
      pos.push(e, this.h(e, n) + hgt, -n); col.push(...c); size.push(s); always.push(alw);
    };
    for (const rw of this.ap.runways) {
      const [a, b] = rw.ends;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L, px = uy, py = -ux;
      const off = rw.width / 2 + 1.5;
      for (let m = 0; m <= L; m += 60) {
        for (const s of [-1, 1]) add(a.x + ux * m + px * off * s, a.y + uy * m + py * off * s, [1, 0.95, 0.8]);
      }
      // threshold (green) and runway end (red) bars at both ends, including displaced thresholds
      for (const [end, dir] of [[a, 1], [b, -1]] as const) {
        const tx = end.x + ux * dir * end.displaced, ty = end.y + uy * dir * end.displaced;
        for (let k = -6; k <= 6; k++) {
          add(tx + px * k * 3.5, ty + py * k * 3.5, [0.2, 1, 0.35], 1.2);
          add(end.x + px * k * 3.5 - ux * dir * 1, end.y + py * k * 3.5 - uy * dir * 1, [1, 0.12, 0.1], 1.1);
        }
        // simple approach light centreline (barrettes every 30 m out to 600 m)
        for (let m = 30; m <= 600; m += 30) {
          for (let k = -2; k <= 2; k++) add(end.x - ux * dir * m + px * k * 1.2, end.y - uy * dir * m + py * k * 1.2, [1, 0.95, 0.8], 1, 0, 1.5);
        }
      }
    }
    // taxiway edge (blue)
    for (const line of this.ap.taxiways) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [x0, y0] = line[i], [x1, y1] = line[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
        for (let m = 0; m < L; m += 45) {
          const x = x0 + ((x1 - x0) * m) / L, y = y0 + ((y1 - y0) * m) / L;
          for (const s of [-1, 1]) add(x + nx * (TAXIWAY_HALF_WIDTH + 1) * s, y + ny * (TAXIWAY_HALF_WIDTH + 1) * s, [0.2, 0.35, 1], 0.7);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('always', new THREE.Float32BufferAttribute(always, 1));
    const pts = new THREE.Points(g, this.lightMat);
    pts.frustumCulled = false;
    pts.name = 'airfield lights';
    this.group.add(pts);

    // PAPI: 4 units left of each runway, 300 m past the (displaced) threshold
    for (const rw of this.ap.runways) {
      const [a, b] = rw.ends;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L, px = uy, py = -ux;
      for (const [end, dir] of [[a, 1], [b, -1]] as const) {
        const d = end.displaced + 300;
        const units: PapiUnit[] = [];
        const ppos: number[] = [], pcol: number[] = [], psz: number[] = [], palw: number[] = [];
        // left side relative to the landing direction; angles outer -> inner (ICAO 3 deg)
        const angles = [3.5, 3 + 1 / 6, 3 - 1 / 6, 2.5];
        for (let k = 0; k < 4; k++) {
          const lat = -(rw.width / 2 + 15 + k * 9) * dir;
          const e = end.x + ux * dir * d + px * lat, n = end.y + uy * dir * d + py * lat;
          const p = new THREE.Vector3(e, this.h(e, n) + 0.9, -n);
          units.push({ pos: p, angle: angles[k], light: 0 });
          ppos.push(p.x, p.y, p.z); pcol.push(1, 1, 1); psz.push(2.2); palw.push(1);
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3));
        const colors = new THREE.Float32BufferAttribute(pcol, 3);
        pg.setAttribute('color', colors);
        pg.setAttribute('size', new THREE.Float32BufferAttribute(psz, 1));
        pg.setAttribute('always', new THREE.Float32BufferAttribute(palw, 1));
        const points = new THREE.Points(pg, this.lightMat);
        points.frustumCulled = false;
        points.name = `PAPI ${end.ident}`;
        this.group.add(points);
        this.papi.push({ units, colors, points });
      }
    }
  }

  /** PAPI colour depends on the observer's elevation angle above each unit. */
  update(eye: THREE.Vector3, lightLevel: number, pixelScale: number) {
    this.lightLevel = lightLevel;
    this.lightMat.uniforms.uLevel.value = lightLevel;
    this.lightMat.uniforms.uScale.value = pixelScale;
    for (const p of this.papi) {
      p.units.forEach((u, k) => {
        const d = Math.hypot(eye.x - u.pos.x, eye.z - u.pos.z);
        const elev = (Math.atan2(eye.y - u.pos.y, d) * 180) / Math.PI;
        // ~0.25 deg transition sector as on real units
        const t = THREE.MathUtils.clamp((elev - u.angle) / 0.25 + 0.5, 0, 1);
        p.colors.setXYZ(k, 1, 0.12 + 0.88 * t, 0.1 + 0.9 * t);
      });
      p.colors.needsUpdate = true;
    }
  }

  /** For tests / HUD: number of white PAPI lights seen from eye for the given runway end. */
  papiWhites(eye: THREE.Vector3, endIndex: number) {
    const p = this.papi[endIndex];
    return p.units.filter((u) => Math.atan2(eye.y - u.pos.y, Math.hypot(eye.x - u.pos.x, eye.z - u.pos.z)) * 180 / Math.PI > u.angle).length;
  }
}
