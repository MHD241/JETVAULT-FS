// Heading-up minimap: Sentinel-2 imagery, roads and runways around the aircraft.

import { Aircraft } from '../sim/fdm/aircraft';
import { AirportData } from '../world/airport';

const BASE = 2048; // px

export class Minimap {
  readonly el: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  rangeM = 3500;
  private HALF: number;

  constructor(ap: AirportData, imagery: CanvasImageSource | null, roads: [string, [number, number][]][] | null, half = 12000) {
    this.HALF = half;
    const HALF = half;
    this.el = document.createElement('canvas');
    this.el.className = 'jv-minimap';
    this.el.width = this.el.height = 200;
    document.body.appendChild(this.el);
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = BASE;
    const g = this.base.getContext('2d')!;
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, BASE, BASE);
    if (imagery) g.drawImage(imagery, 0, 0, BASE, BASE);
    const k = BASE / (2 * HALF);
    const P = (x: number, y: number): [number, number] => [(x + HALF) * k, (HALF - y) * k];
    if (roads) {
      g.strokeStyle = 'rgba(235,235,225,0.55)'; g.lineCap = 'round';
      for (const [cls, pts] of roads) {
        if (!['motorway', 'trunk', 'primary', 'secondary'].includes(cls)) continue;
        g.lineWidth = cls === 'motorway' || cls === 'trunk' ? 2.5 : 1.4;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y))));
        g.stroke();
      }
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 5;
    for (const rw of ap.runways) { g.beginPath(); g.moveTo(...P(rw.ends[0].x, rw.ends[0].y)); g.lineTo(...P(rw.ends[1].x, rw.ends[1].y)); g.stroke(); }
  }

  update(ac: Aircraft) {
    const g = this.el.getContext('2d')!;
    const S = this.el.width;
    const HALF = this.HALF;
    const k = BASE / (2 * HALF);
    const e = ac.pos.y, n = ac.pos.x, psi = ac.euler[2];
    g.save();
    g.fillStyle = '#0b1426'; g.fillRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    g.translate(S / 2, S / 2);
    g.rotate(-psi);
    const s = (S / 2) / (this.rangeM * k);
    g.scale(s, s);
    g.drawImage(this.base, -(e + HALF) * k, -(HALF - n) * k);
    g.restore();
    // aircraft symbol (always pointing up)
    g.fillStyle = '#4f8ef7'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(S / 2, S / 2 - 10); g.lineTo(S / 2 + 7, S / 2 + 8); g.lineTo(S / 2, S / 2 + 4); g.lineTo(S / 2 - 7, S / 2 + 8); g.closePath(); g.fill(); g.stroke();
    // north marker
    g.fillStyle = '#e9edf3'; g.font = '600 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', S / 2 + Math.sin(-psi) * (S / 2 - 12), S / 2 - Math.cos(-psi) * (S / 2 - 12));
  }
}
