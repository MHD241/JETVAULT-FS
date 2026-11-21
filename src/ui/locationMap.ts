// The "where do you want to start" map (Fly Now, step 2): the UK with a star at every airport and its ICAO code beside it. Click a star and the map zooms
// into a bird's-eye view of that airport (satellite image, runways, taxiways) with a star at every gate; click a gate to start there.
import type { World } from '../world/world';

export interface LocationMapHost {
  world: World;
  /** The lo-resolution hillshade of the whole region, one canvas square covering the grid (see Menu.hillshadeCanvas). */
  hillshade(): HTMLCanvasElement;
  /** Makes this airport current and loads its detail; resolves when its data is available in `world.airport`. */
  select(icao: string): Promise<void>;
  /** Stand positions [east, north, heading deg] of the current airport, in the order the game spawns them. */
  stands(): [number, number, number][];
  pickedStand(): number | null;
  onPick(index: number): void;
  /** A "final approach" star was picked (the runway end's designator) / which one is picked now. */
  onPickFinal(ident: string): void;
  pickedFinal(): string | null;
  visible(icao: string): boolean;
}

/** How far in front of a runway end its FINAL star is drawn (metres): symbolic, the real start distance depends on the aircraft. */
const FINAL_DIST = 1800;
interface View { cx: number; cy: number; half: number }
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class LocationMap {
  private g: CanvasRenderingContext2D;
  private view: View; private from: View; private to: View; private t0 = 0; private anim = false;
  private mode: 'uk' | 'loading' | 'airport' = 'uk';
  private icao = '';
  private img: HTMLImageElement | null = null;
  private hover: { kind: 'airport' | 'stand' | 'final'; i: number } | null = null;
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private dead = false;
  onMode: ((m: 'uk' | 'loading' | 'airport') => void) | null = null;

  constructor(private cv: HTMLCanvasElement, private h: LocationMapHost) {
    this.g = cv.getContext('2d')!;
    const half = h.world.terrain.lo!.half;
    this.view = { cx: 0, cy: -50000, half: half - 50000 }; this.from = { ...this.view }; this.to = { ...this.view };
    cv.onpointermove = (e) => this.move(e); cv.onpointerdown = (e) => this.down(e); cv.onpointerup = (e) => this.up(e);
    cv.onpointerleave = () => { this.hover = null; this.draw(); };
    cv.onwheel = (e) => { e.preventDefault(); this.wheel(e); };
    this.draw();
  }
  destroy() { this.dead = true; }
  get inAirport() { return this.mode === 'airport'; }

  private P(e: number, n: number): [number, number] { const W = this.cv.width, v = this.view; return [((e - v.cx) / (2 * v.half) + 0.5) * W, ((v.cy - n) / (2 * v.half) + 0.5) * W]; }
  private world(px: number, py: number): [number, number] { const W = this.cv.width, v = this.view; return [(px / W - 0.5) * 2 * v.half + v.cx, v.cy - (py / W - 0.5) * 2 * v.half]; }
  private pos(e: PointerEvent): [number, number] { const r = this.cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * this.cv.width, ((e.clientY - r.top) / r.height) * this.cv.height]; }

  /** Smoothly changes the view over `ms`. */
  private go(to: View, ms = 900) { this.from = { ...this.view }; this.to = to; this.t0 = performance.now(); this.anim = true; const tick = () => { if (this.dead) return; const k = Math.min(1, (performance.now() - this.t0) / ms), e = ease(k);
    this.view = { cx: this.from.cx + (this.to.cx - this.from.cx) * e, cy: this.from.cy + (this.to.cy - this.from.cy) * e, half: Math.exp(Math.log(this.from.half) + (Math.log(this.to.half) - Math.log(this.from.half)) * e) };
    this.draw(); if (k < 1) requestAnimationFrame(tick); else { this.anim = false; } }; tick(); }

  /** Back out to the UK. */
  showUK() { this.mode = 'uk'; this.hover = null; this.onMode?.('uk'); this.go({ cx: 0, cy: -50000, half: this.h.world.terrain.lo!.half - 50000 }, 800); }

  private airports() { return this.h.world.airports.filter((a) => this.h.visible(a.icao)).map((a) => { const e = a.runways.flatMap((r) => r.ends); return { icao: a.icao, name: a.name, x: e.reduce((s, q) => s + q.x, 0) / e.length, y: e.reduce((s, q) => s + q.y, 0) / e.length }; }); }

  async open(icao: string) {
    const a = this.airports().find((x) => x.icao === icao); if (!a) return;
    this.mode = 'loading'; this.icao = icao; this.hover = null; this.onMode?.('loading');
    this.img = null;
    const pm = this.h.world.patchOf(icao);
    if (pm) { const im = new Image(); im.onload = () => { if (this.icao === icao) { this.img = im; this.draw(); } }; im.src = new URL(`./data/scot/${pm.id}/imagery.jpg`, document.baseURI).href; }
    const zoom = this.go({ cx: a.x, cy: a.y, half: 3200 }, 1100);
    void zoom;
    await this.h.select(icao);
    if (this.dead || this.icao !== icao) return;
    // fit the view to the runways and stands
    const ap = this.h.world.airport; const pts: [number, number][] = [...ap.runways.flatMap((r) => r.ends.map((e) => [e.x, e.y] as [number, number])), ...this.h.stands().map((s) => [s[0], s[1]] as [number, number])];
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const fp = this.finals().flatMap((f) => [[f.x, f.y], [f.tx, f.ty]]);   // the view has to hold the FINAL stars too
    const X0 = Math.min(x0, ...fp.map((p) => p[0])), X1 = Math.max(x1, ...fp.map((p) => p[0])), Y0 = Math.min(y0, ...fp.map((p) => p[1])), Y1 = Math.max(y1, ...fp.map((p) => p[1]));
    const half = Math.max(900, Math.max(X1 - X0, Y1 - Y0) * 0.56 + 200);
    this.mode = 'airport'; this.onMode?.('airport'); this.go({ cx: (X0 + X1) / 2, cy: (Y0 + Y1) / 2, half }, 700);
  }

  /** The final-approach stars: one on the extended centreline in front of every runway end. */
  private finals(): { ident: string; x: number; y: number; tx: number; ty: number }[] {
    const D = FINAL_DIST;
    return this.h.world.airport.runways.flatMap((r) => r.ends).map((e) => { const h = (e.hdgTrue * Math.PI) / 180; return { ident: e.ident, tx: e.x, ty: e.y, x: e.x - Math.sin(h) * D, y: e.y - Math.cos(h) * D }; });
  }
  private hit(px: number, py: number): { kind: 'airport' | 'stand' | 'final'; i: number } | null {
    if (this.mode === 'uk') { let best = -1, d = 16; this.airports().forEach((a, i) => { const [x, y] = this.P(a.x, a.y), dd = Math.hypot(x - px, y - py); if (dd < d) { d = dd; best = i; } }); return best >= 0 ? { kind: 'airport', i: best } : null; }
    if (this.mode === 'airport') { let fb = -1, fd = 18; this.finals().forEach((f, i) => { const [x, y] = this.P(f.x, f.y), dd = Math.hypot(x - px, y - py); if (dd < fd) { fd = dd; fb = i; } }); if (fb >= 0) return { kind: 'final', i: fb }; let best = -1, d = 14; this.h.stands().forEach((s, i) => { const [x, y] = this.P(s[0], s[1]), dd = Math.hypot(x - px, y - py); if (dd < d) { d = dd; best = i; } }); return best >= 0 ? { kind: 'stand', i: best } : null; }
    return null;
  }
  private move(e: PointerEvent) {
    const [px, py] = this.pos(e);
    if (this.drag && this.mode === 'uk') {
      if (Math.hypot(px - this.drag.x, py - this.drag.y) > 4) this.drag.moved = true;
      if (this.drag.moved) { const k = (2 * this.view.half) / this.cv.width; this.view.cx = this.drag.cx - (px - this.drag.x) * k; this.view.cy = this.drag.cy + (py - this.drag.y) * k; this.clamp(); this.draw(); return; }
    }
    const h = this.hit(px, py); if (JSON.stringify(h) !== JSON.stringify(this.hover)) { this.hover = h; this.cv.style.cursor = h ? 'pointer' : this.mode === 'uk' ? 'grab' : 'default'; this.draw(); }
  }
  private down(e: PointerEvent) { const [px, py] = this.pos(e); this.drag = { x: px, y: py, cx: this.view.cx, cy: this.view.cy, moved: false }; try { this.cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  private up(e: PointerEvent) {
    const d = this.drag; this.drag = null; if (!d || d.moved || this.anim || this.mode === 'loading') return;
    const [px, py] = this.pos(e), h = this.hit(px, py); if (!h) return;
    if (h.kind === 'airport') void this.open(this.airports()[h.i].icao); else if (h.kind === 'final') this.h.onPickFinal(this.finals()[h.i].ident); else this.h.onPick(h.i);
    this.draw();
  }
  private wheel(e: WheelEvent) {
    if (this.mode !== 'uk') return;
    const r = this.cv.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * this.cv.width, py = ((e.clientY - r.top) / r.height) * this.cv.height;
    const [we, wn] = this.world(px, py), k = e.deltaY < 0 ? 0.8 : 1.25, full = this.h.world.terrain.lo!.half;
    const half = Math.max(20000, Math.min(full, this.view.half * k)), f = half / this.view.half;
    this.view = { half, cx: we - (we - this.view.cx) * f, cy: wn - (wn - this.view.cy) * f }; this.clamp(); this.draw();
  }
  private clamp() { const full = this.h.world.terrain.lo!.half, v = this.view, m = full - v.half; v.cx = Math.max(-m, Math.min(m, v.cx)); v.cy = Math.max(-m, Math.min(m, v.cy)); }

  private star(x: number, y: number, r: number, fill: string, stroke = '#06101e') {
    const g = this.g; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fillStyle = fill; g.fill(); g.lineWidth = 1.6; g.strokeStyle = stroke; g.stroke();
  }
  private label(t: string, x: number, y: number, size = 14) { const g = this.g; g.font = `600 ${size}px system-ui, sans-serif`; g.lineWidth = 4; g.strokeStyle = 'rgba(6,14,28,.9)'; g.strokeText(t, x, y); g.fillStyle = '#f2f6fb'; g.fillText(t, x, y); }

  draw() {
    const g = this.g, W = this.cv.width, v = this.view;
    g.fillStyle = '#0a1424'; g.fillRect(0, 0, W, W);
    const hs = this.h.hillshade(), full = this.h.world.terrain.lo!.half, [x0, y0] = this.P(-full, full), size = (2 * full / (2 * v.half)) * W;
    g.imageSmoothingEnabled = true; g.drawImage(hs, x0, y0, size, size);
    const ap = this.h.world.airport;
    if (this.mode !== 'uk' && this.img) {
      const pm = this.h.world.patchOf(this.icao);
      if (pm) { const [ix, iy] = this.P(pm.cx - pm.imgHalf, pm.cy + pm.imgHalf), s = (2 * pm.imgHalf / (2 * v.half)) * W; g.drawImage(this.img, ix, iy, s, s); }
    }
    if (this.mode === 'airport' && ap.icao === this.icao) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const t of ap.taxiways) { g.beginPath(); t.forEach((p, i) => { const [x, y] = this.P(p[0], p[1]); g[i ? 'lineTo' : 'moveTo'](x, y); }); g.strokeStyle = 'rgba(205,210,220,.55)'; g.lineWidth = Math.max(1, 22 / (2 * v.half) * W); g.stroke(); }
      for (const a of ap.aprons) { g.beginPath(); a.forEach((p, i) => { const [x, y] = this.P(p[0], p[1]); g[i ? 'lineTo' : 'moveTo'](x, y); }); g.closePath(); g.fillStyle = 'rgba(120,130,150,.28)'; g.fill(); }
      for (const r of ap.runways) { const [ax, ay] = this.P(r.ends[0].x, r.ends[0].y), [bx, by] = this.P(r.ends[1].x, r.ends[1].y); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.strokeStyle = 'rgba(245,247,250,.9)'; g.lineWidth = Math.max(2, r.width / (2 * v.half) * W * 1.2); g.stroke();
        this.label(r.ends[0].ident, ax - 14, ay - 8, 12); this.label(r.ends[1].ident, bx + 6, by - 8, 12); }
      const picked = this.h.pickedStand();
      this.h.stands().forEach((s, i) => { const [x, y] = this.P(s[0], s[1]); const sel = i === picked, hv = this.hover?.kind === 'stand' && this.hover.i === i; this.star(x, y, sel ? 11 : hv ? 10 : 6.5, sel ? '#ffd24a' : hv ? '#ffffff' : '#7fd0ff'); });
      if (this.hover?.kind === 'stand') { const s = this.h.stands()[this.hover.i], [x, y] = this.P(s[0], s[1]); this.label(`Gate ${this.hover.i + 1}`, x + 12, y - 10, 13); }
      const pf = this.h.pickedFinal();
      this.finals().forEach((f, i) => {
        const [x, y] = this.P(f.x, f.y), [tx, ty] = this.P(f.tx, f.ty), sel = f.ident === pf, hv = this.hover?.kind === 'final' && this.hover.i === i;
        g.setLineDash([7, 6]); g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.strokeStyle = sel ? 'rgba(255,210,74,.95)' : 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
        this.star(x, y, sel ? 14 : hv ? 13 : 10, sel ? '#ffd24a' : '#ff9d4a'); this.label(`FINAL ${f.ident}`, x + 14, y + 5, 13);
      });
      this.label(`${ap.icao} ${ap.name}`, 16, 28, 18);
    } else if (this.mode === 'loading') {
      this.label('Loading the airport...', 16, 28, 18);
    }
    if (this.mode === 'uk') {
      this.airports().forEach((a, i) => { const [x, y] = this.P(a.x, a.y); const cur = a.icao === ap.icao, hv = this.hover?.kind === 'airport' && this.hover.i === i; this.star(x, y, hv ? 13 : 10, cur ? '#ffd24a' : '#ffffff'); this.label(a.icao, x + 14, y + 5, 14); });
      this.label('Pick an airport star  ·  scroll to zoom, drag to move', 16, W - 16, 13);
    }
  }
}
