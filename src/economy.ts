// JetCoins: the in-game currency. The Boeing 737-800 and the Airbus A320 are free from the start; the other aircraft are bought with JetCoins earned by flying
// (distance flown in the air plus a bonus for the landing). Stored in this browser (localStorage). The Pro edition (?pro) has everything unlocked.
import { PRO, FREE_AIRCRAFT } from './config';

/** What the locked aircraft cost. */
export const PRICES: Record<string, number> = { a340: 800, a350: 1000, c17: 1200, drone: 300 };
export const START_COINS = 100;
const KEY = 'jetvault.wallet';

interface Saved { coins: number; owned: string[]; flights: number; flownKm: number }

/** JetCoins for a distance flown in the air: 2 per km. */
export const coinsForDistance = (metres: number) => Math.floor((metres / 1000) * 2);

/** Landing bonus from the sink rate at touchdown (m/s, positive = descending). */
export function landingBonus(sinkRate: number): { coins: number; label: string } {
  const v = Math.abs(sinkRate);
  if (v < 1.2) return { coins: 150, label: 'a butter landing' };
  if (v < 2.5) return { coins: 100, label: 'a smooth landing' };
  if (v < 3.7) return { coins: 60, label: 'a firm landing' };
  return { coins: 20, label: 'a hard landing' };
}

export class Wallet {
  private s: Saved = { coins: START_COINS, owned: [], flights: 0, flownKm: 0 };
  private listeners: (() => void)[] = [];
  constructor() {
    try { const t = localStorage.getItem(KEY); if (t) { const j = JSON.parse(t) as Partial<Saved>; this.s = { coins: Math.max(0, Math.floor(j.coins ?? START_COINS)), owned: Array.isArray(j.owned) ? j.owned.filter((x) => typeof x === 'string') : [], flights: j.flights ?? 0, flownKm: j.flownKm ?? 0 }; } } catch { /* no storage: in-memory only */ }
  }
  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* ignore */ } for (const f of this.listeners) f(); }
  onChange(f: () => void) { this.listeners.push(f); }
  get coins() { return this.s.coins; }
  get flights() { return this.s.flights; }
  get flownKm() { return this.s.flownKm; }
  owns(id: string) { return PRO || FREE_AIRCRAFT.includes(id) || this.s.owned.includes(id); }
  price(id: string) { return PRICES[id] ?? 0; }
  canBuy(id: string) { return !this.owns(id) && this.price(id) > 0 && this.s.coins >= this.price(id); }
  /** Buys an aircraft; false if it is already yours, not for sale, or too expensive. */
  buy(id: string): boolean {
    if (!this.canBuy(id)) return false;
    this.s.coins -= this.price(id); this.s.owned.push(id); this.save(); return true;
  }
  add(coins: number, km = 0) { this.s.coins += Math.max(0, Math.floor(coins)); this.s.flownKm += km; this.s.flights += 1; this.save(); }
}

export const wallet = new Wallet();
export const aircraftAvailable = (id: string) => wallet.owns(id);

/**
 * Watches a flight and pays out when it ends with a landing: call update() every frame. It counts the distance flown in the air since the last
 * time the aircraft was on the ground, and at touchdown returns the reward (once), using the worst sink rate in the last second before contact.
 */
export class FlightRewards {
  private airborne = false; private distM = 0; private sink = 0; private airT = 0;
  update(dt: number, onGround: boolean, agl: number, groundSpeed: number, vertSpeedDown: number, crashed: boolean): { coins: number; km: number; label: string } | null {
    if (crashed) { this.airborne = false; this.distM = 0; return null; }
    if (!onGround && agl > 6) {
      this.airborne = true; this.distM += groundSpeed * dt; this.airT += dt;
      if (agl < 25) this.sink = Math.max(this.sink * Math.exp(-dt), vertSpeedDown); else this.sink = 0;
      return null;
    }
    if (onGround && this.airborne) {
      this.airborne = false;
      const d = this.distM, t = this.airT, sink = this.sink; this.distM = 0; this.airT = 0; this.sink = 0;
      if (d < 2000 || t < 30) return null;    // a hop does not pay
      const b = landingBonus(sink), c = coinsForDistance(d) + b.coins;
      return { coins: c, km: d / 1000, label: b.label };
    }
    return null;
  }
}
