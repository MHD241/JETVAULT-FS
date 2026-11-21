// Frame-rate helpers for big, sharp screens (a 24-inch M1 iMac is 4480 x 2520 pixels): a cap on the number of pixels drawn per frame, and an automatic
// resolution scale that backs off when the frame rate is low and recovers when it is high.

/** Pixel ratio for the renderer: the device ratio (at most `maxRatio`) times the quality scale, lowered so that no more than `budget` pixels are drawn. */
export function effectivePixelRatio(cssW: number, cssH: number, dpr: number, scale: number, maxRatio = 1.5, budget = 3.3e6): number {
  const wanted = Math.min(dpr, maxRatio) * scale;
  const cap = Math.sqrt(budget / Math.max(1, cssW * cssH));
  return Math.max(0.5, Math.min(wanted, cap));
}

/**
 * Automatic resolution scale (0.55..1): feed it every frame's duration while flying. Below `low` fps (averaged over about 1.5 s) it steps the scale down,
 * after `calm` seconds above `high` fps it steps it back up. Returns the new scale when it changed, otherwise null.
 */
export class AutoScale {
  scale = 1;
  private times: number[] = []; private cool = 0; private good = 0;
  constructor(private low = 38, private high = 56, private calm = 8, public min = 0.55) {}
  reset() { this.times = []; this.cool = 0; this.good = 0; }
  update(dt: number): number | null {
    if (!(dt > 0) || dt > 0.5) { this.times = []; return null; }   // a pause, a tab switch or a loading hitch is not a measurement
    this.times.push(dt); if (this.times.length > 90) this.times.shift();
    this.cool -= dt;
    if (this.times.length < 45) return null;
    const fps = this.times.length / this.times.reduce((a, b) => a + b, 0);
    if (fps < this.low && this.scale > this.min + 1e-6 && this.cool <= 0) { this.scale = Math.max(this.min, +(this.scale - 0.12).toFixed(2)); this.cool = 3; this.times = []; this.good = 0; return this.scale; }
    if (fps > this.high && this.scale < 1) { this.good += dt; if (this.good >= this.calm && this.cool <= 0) { this.scale = Math.min(1, +(this.scale + 0.06).toFixed(2)); this.good = 0; this.cool = 3; this.times = []; return this.scale; } } else this.good = 0;
    return null;
  }
}
