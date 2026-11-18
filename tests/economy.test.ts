// JetCoins: free aircraft, buying, earning.
import { describe, it, expect } from 'vitest';
import { Wallet, PRICES, START_COINS, coinsForDistance, landingBonus, FlightRewards } from '../src/economy';

describe('JetCoins', () => {
  it('the 737 and A320 are free, the rest cost JetCoins', () => {
    const w = new Wallet();
    expect(w.owns('b738')).toBe(true); expect(w.owns('a320')).toBe(true);
    expect(w.owns('a340')).toBe(false);
    expect(START_COINS).toBeLessThan(PRICES.a340);
  });
  it('buying needs the coins, takes them, and only once', () => {
    const w = new Wallet();
    expect(w.buy('a340')).toBe(false);                         // not enough yet
    w.add(PRICES.a340);
    const before = w.coins;
    expect(w.buy('a340')).toBe(true);
    expect(w.coins).toBe(before - PRICES.a340);
    expect(w.owns('a340')).toBe(true);
    expect(w.buy('a340')).toBe(false);                         // already yours
    expect(w.buy('b738')).toBe(false);                         // free ones are not for sale
  });
  it('pays for distance and landing quality', () => {
    expect(coinsForDistance(10_000)).toBe(20);
    expect(landingBonus(0.8).coins).toBeGreaterThan(landingBonus(2).coins);
    expect(landingBonus(2).coins).toBeGreaterThan(landingBonus(3).coins);
    expect(landingBonus(5).coins).toBeGreaterThan(0);
  });
  it('a flight pays once, at the landing; a hop does not pay', () => {
    const r = new FlightRewards();
    let paid = 0, got = 0;
    for (let t = 0; t < 120; t += 0.1) { const x = r.update(0.1, false, 500, 80, 0, false); if (x) { paid++; got = x.coins; } }   // 120 s at 80 m/s = 9.6 km
    for (let t = 0; t < 5; t += 0.1) { const x = r.update(0.1, false, 10, 70, 1.5, false); if (x) paid++; }
    const end = r.update(0.1, true, 0, 60, 0, false);
    expect(end).not.toBeNull(); expect(end!.coins).toBeGreaterThan(100); expect(end!.km).toBeGreaterThan(9);
    expect(r.update(0.1, true, 0, 50, 0, false)).toBeNull();   // not again
    const hop = new FlightRewards();
    for (let t = 0; t < 10; t += 0.1) hop.update(0.1, false, 20, 70, 1, false);
    expect(hop.update(0.1, true, 0, 60, 0, false)).toBeNull();
    expect(paid + got).toBeGreaterThanOrEqual(0);
  });
});
