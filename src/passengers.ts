// Passengers on board: while you fly an airliner with passengers, their comfort is measured (vertical load factor, bank, pitch) and the landing is judged.
// A smooth flight earns up to 1.5x the JetCoins of the trip, a rough one half. Pure logic, no rendering.

/** Average mass of a passenger with luggage (kg): payload / this = passengers on board. */
export const PAX_KG = 95;
export const paxCount = (payloadKg: number) => Math.max(0, Math.round(payloadKg / PAX_KG));
/** JetCoin multiplier by star rating (index = stars, 1-5). */
export const PAX_MULT = [0, 0.5, 0.75, 1, 1.25, 1.5];

export class ComfortMeter {
  /** Accumulated discomfort (arbitrary units). */
  discomfort = 0; airborneS = 0;
  /** What made the passengers uncomfortable, for their comments. */
  worst: { bumpy: number; banked: number; steep: number } = { bumpy: 0, banked: 0, steep: 0 };
  reset() { this.discomfort = 0; this.airborneS = 0; this.worst = { bumpy: 0, banked: 0, steep: 0 }; }
  /** Call every frame while flying: `nz` load factor in g, bank and pitch in degrees. Only counts while airborne or rolling fast on the ground. */
  update(dt: number, nz: number, bankDeg: number, pitchDeg: number, airborne: boolean) {
    if (!(dt > 0) || dt > 0.5) return;
    if (airborne) this.airborneS += dt;
    const dev = Math.abs(nz - 1), bank = Math.abs(bankDeg), pitch = Math.abs(pitchDeg);
    const bump = Math.max(0, dev - 0.18) * 45, bk = airborne ? Math.max(0, bank - 30) * 0.25 : 0, st = airborne ? Math.max(0, pitch - 16) * 0.25 : 0;
    this.discomfort += (bump + bk + st) * dt; this.worst.bumpy += bump * dt; this.worst.banked += bk * dt; this.worst.steep += st * dt;
  }
  /** Comfort 0..100 (100 = nobody noticed anything). */
  get comfort() { return Math.max(0, Math.min(100, 100 - this.discomfort * 0.35)); }
  /** Stars so far, 1..5 (the flight, without the landing). */
  get liveStars() { const c = this.comfort; return c >= 90 ? 5 : c >= 75 ? 4 : c >= 60 ? 3 : c >= 40 ? 2 : 1; }
}

/** Final rating: the flight's comfort stars, minus one for a firm landing (sink over 2.5 m/s) and two for a hard one (over 3.7 m/s); at least 1. */
export function finalStars(m: ComfortMeter, sinkMs: number): number {
  const v = Math.abs(sinkMs); return Math.max(1, m.liveStars - (v >= 3.7 ? 2 : v >= 2.5 ? 1 : 0));
}

/** What the passengers say. */
export function passengerComment(stars: number, sinkMs: number, m: ComfortMeter): string {
  const v = Math.abs(sinkMs);
  if (stars >= 5) return v < 1.2 ? 'Applause in the cabin. "Best landing we have ever had!"' : 'Smooth all the way. The passengers thank the crew.';
  if (stars === 4) return 'A pleasant flight. A few passengers clap.';
  const w = m.worst, main = Math.max(w.bumpy, w.banked, w.steep);
  if (v >= 3.7) return 'That landing made the whole cabin gasp.';
  if (main === w.bumpy && main > 0) return 'It was a bumpy ride: some passengers felt unwell.';
  if (main === w.banked && main > 0) return 'The turns were too steep for comfort.';
  if (main === w.steep && main > 0) return 'The climb and descent felt too steep.';
  return 'An acceptable flight, but nothing special.';
}
