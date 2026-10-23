// Heading-up minimap: Sentinel-2 imagery, roads and runways around the aircraft where detailed
// patches exist (Edinburgh, Glasgow, Portmoak); elsewhere a coarse land-cover map of Scotland.

import { Aircraft } from '../sim/fdm/aircraft';
import { AirportData } from '../world/airport';
import { LandCover } from '../world/world';

const BASE = 2048; // px per patch base map

export interface MinimapPatch {
  cx: number; cy: number; half: number; // imagery extent (local metres)
  imagery: CanvasImageSource | null;
  roads: [string, [number, number][]][] | null;
  airport: AirportData;
}

interface Base { id: string; canvas: HTMLCanvasElement; p: MinimapPatch }

const LC_COL: Record<number, string> = { 10: '#2b4a30', 20: '#4a5a34', 30: '#58733a', 40: '#6f7a45', 50: '#8a8590', 60: '#7a7260', 70: '#e8eef2', 80: '#1d3c5e', 90: '#4a6a55', 100: '#6a5a48' };

export class Minimap {
  readonly el: HTMLCanvasElement;
  private bases: Base[] = [];
  private tmp = document.createElement('canvas');
  rangeM = 3500;

  constructor(private landcover: LandCover | null) {
    this.el = document.createElement('canvas');
    this.el.className = 'jv-minimap';
    this.el.width = this.el.height = 200;
    document.body.appendChild(this.el);
    this.tmp.width = this.tmp.height = 100;
  }

  addPatch(id: string, p: MinimapPatch) {
    this.removePatch(id);
    this.bases.push({ id, canvas: this.makeBase(p), p });
  }

  removePatch(id: string) {
    const b = this.bases.find((x) => x.id === id);
    if (b) { b.canvas.width = 0; this.bases = this.bases.filter((x) => x !== b); } // releases the bitmap memory
  }

  private makeBase(p: MinimapPatch) {
    const c = document.createElement('canvas');
    c.width = c.height = BASE;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, BASE, BASE);
    if (p.imagery) g.drawImage(p.imagery, 0, 0, BASE, BASE);
    const k = BASE / (2 * p.half);
    const P = (x: number, y: number): [number, number] => [(x - p.cx + p.half) * k, (p.cy + p.half - y) * k];
    if (p.roads) {
      g.strokeStyle = 'rgba(235,235,225,0.55)'; g.lineCap = 'round';
      for (const [cls, pts] of p.roads) {
        if (!['motorway', 'trunk', 'primary', 'secondary'].includes(cls)) continue;
        g.lineWidth = cls === 'motorway' || cls === 'trunk' ? 2.5 : 1.4;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y))));
        g.stroke();
      }
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 5;
    for (const rw of p.airport.runways) { g.beginPath(); g.moveTo(...P(rw.ends[0].x, rw.ends[0].y)); g.lineTo(...P(rw.ends[1].x, rw.ends[1].y)); g.stroke(); }
    return c;
  }

  update(ac: Aircraft) {
    const g = this.el.getContext('2d')!;
    const S = this.el.width;
    const e = ac.pos.y, n = ac.pos.x, psi = ac.euler[2];
    g.save();
    g.fillStyle = '#0b1426'; g.fillRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    g.translate(S / 2, S / 2);
    g.rotate(-psi);
    const base = this.bases.find((b) => Math.abs(e - b.p.cx) < b.p.half - this.rangeM * 0.7 && Math.abs(n - b.p.cy) < b.p.half - this.rangeM * 0.7);
    if (base) {
      const k = BASE / (2 * base.p.half);
      const s = (S / 2) / (this.rangeM * k);
      g.scale(s, s);
      g.drawImage(base.canvas, -(e - base.p.cx + base.p.half) * k, -(base.p.cy + base.p.half - n) * k);
    } else if (this.landcover) {
      // regional map: sample the land cover into a small bitmap (heading-up, 40 km across)
      const range = 20000, t = this.tmp, tg = t.getContext('2d')!, W = t.width;
      const img = tg.createImageData(W, W);
      const ca = Math.cos(psi), sa = Math.sin(psi);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const u = ((x + 0.5) / W - 0.5) * 2 * range, v = (0.5 - (y + 0.5) / W) * 2 * range; // right, forward (m)
        const E = e + u * ca + v * sa, N = n - u * sa + v * ca;
        const col = LC_COL[this.landcover.at(E, N)] ?? '#58733a';
        const i = (y * W + x) * 4;
        img.data[i] = parseInt(col.slice(1, 3), 16); img.data[i + 1] = parseInt(col.slice(3, 5), 16); img.data[i + 2] = parseInt(col.slice(5, 7), 16); img.data[i + 3] = 255;
      }
      tg.putImageData(img, 0, 0);
      g.rotate(psi); // the bitmap is already heading-up; undo the rotation applied above
      g.imageSmoothingEnabled = false;
      g.drawImage(t, -S / 2, -S / 2, S, S);
    }
    g.restore();
    // aircraft symbol (always pointing up)
    g.fillStyle = '#4f8ef7'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(S / 2, S / 2 - 10); g.lineTo(S / 2 + 7, S / 2 + 8); g.lineTo(S / 2, S / 2 + 4); g.lineTo(S / 2 - 7, S / 2 + 8); g.closePath(); g.fill(); g.stroke();
    // north marker
    g.fillStyle = '#e9edf3'; g.font = '600 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', S / 2 + Math.sin(-psi) * (S / 2 - 12), S / 2 - Math.cos(-psi) * (S / 2 - 12));
  }
}
