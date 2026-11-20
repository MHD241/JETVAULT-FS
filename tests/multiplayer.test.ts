// Multiplayer logic over an in-memory network: roster, states with dead reckoning, chat, weather share, leaving, and hostile input.
import { describe, it, expect } from 'vitest';
import { Multiplayer, MemoryHub, cleanState, cleanName, MAX_PLAYERS, PlayerState } from '../src/net/multiplayer';

const st = (p: [number, number, number], v: [number, number, number] = [0, 0, 0]): PlayerState => ({ name: 'x', ac: 'a320', p, q: [1, 0, 0, 0], v, gear: 1, flap: 0.5, lights: 3 });
function room(n: number) {
  const hub = new MemoryHub(); let t = 100; const clock = () => t;
  const names = ['Host', 'Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'];
  const mps = Array.from({ length: n }, (_, i) => new Multiplayer(hub.node(`n${i}`, i === 0), names[i], i === 0, clock));
  return { hub, mps, tick: (s: number) => { t += s; } };
}

describe('multiplayer', () => {
  it('everybody learns everybody (roster), also players who join later', () => {
    const { mps } = room(3);
    for (const m of mps) expect(m.roster.map((r) => r.name).sort()).toEqual(['Ann', 'Host', 'Pilot', 'Bob'].filter((x) => x !== 'Pilot').sort());
  });
  it('a state reaches the others through the host and is dead-reckoned', () => {
    const { mps, tick } = room(3);
    mps[1].update(1, () => st([100, 200, -300], [10, 0, 0]));
    for (const i of [0, 2]) {
      const p = mps[i].poses(); expect(p.length).toBe(1); expect(p[0].name).toBe('Ann'); expect(p[0].p).toEqual([100, 200, -300]);
    }
    tick(0.3);
    expect(mps[2].poses()[0].p[0]).toBeCloseTo(103, 5);   // 10 m/s for 0.3 s
    tick(5);
    expect(mps[2].poses()[0].p[0]).toBeCloseTo(106, 5);   // never more than 0.6 s ahead
    tick(20);
    expect(mps[2].poses().length).toBe(0);                 // silent for 15 s: not drawn
  });
  it('old or repeated packets are ignored', () => {
    const { mps } = room(2);
    mps[1].update(1, () => st([1, 1, 1])); mps[1].update(1, () => st([2, 2, 2]));
    expect(mps[0].poses()[0].p).toEqual([2, 2, 2]);
    (mps[0] as unknown as { receive(f: string, m: unknown): void }).receive('n1', { t: 'state', id: 'n1', s: st([9, 9, 9]), n: 1 });
    expect(mps[0].poses()[0].p).toEqual([2, 2, 2]);
  });
  it('chat goes to everybody and leaving removes the player', () => {
    const { mps } = room(3); const got: string[] = [];
    mps[2].onChat = (n, t) => got.push(`${n}: ${t}`);
    mps[1].say('hello all'); expect(got).toEqual(['Ann: hello all']);
    mps[1].leave(); expect(mps[2].roster.map((r) => r.name)).not.toContain('Ann');
    expect(mps[0].roster.map((r) => r.name)).not.toContain('Ann');
  });
  it('the host shares its weather and time with a player who joins', () => {
    const hub = new MemoryHub(); const host = new Multiplayer(hub.node('h', true), 'Host', true, () => 0);
    host.getWeather = () => ({ dayOfYear: 190, timeOfDay: 19.9, cloudCover: 'SCT', windDirection: 240, windSpeed: 8, qnh: 1013, temperatureC: 12 });
    let wx: unknown = null; const guest = new Multiplayer(hub.node('g'), 'Ann', false, () => 0);
    guest.onWeather = (w) => { wx = w; };
    guest.net.send({ t: 'hello', id: 'g', name: 'Ann' });   // (re-introduce so the callback is set when the host answers)
    expect(wx).toMatchObject({ timeOfDay: 19.9, cloudCover: 'SCT', qnh: 1013 });
  });
  it('a room is limited to 8 players', () => {
    const { mps } = room(9);
    expect(mps[0].roster.length).toBeLessThanOrEqual(MAX_PLAYERS);
  });
  it('hostile input is cleaned or dropped', () => {
    expect(cleanName('<img src=x onerror=alert(1)>very long name here')).not.toMatch(/[<>=()]/);
    expect(cleanName('<script>')).toBe('script');
    expect(cleanName('')).toBe('Pilot');
    expect(cleanName('a'.repeat(50)).length).toBe(16);
    expect(cleanState({ p: [NaN, 1, 1], q: [1, 0, 0, 0], v: [0, 0, 0] })?.p[0]).toBe(0);
    expect(cleanState({ p: [1, 1, 1], q: [0, 0, 0, 0], v: [0, 0, 0] })).toBeNull();
    expect(cleanState({ p: [1e30, 1, 1], q: [2, 0, 0, 0], v: [9999, 0, 0] })).toMatchObject({ p: [2e6, 1, 1], q: [1, 0, 0, 0], v: [400, 0, 0] });
    expect(cleanState('nope')).toBeNull();
    const { mps } = room(2);
    (mps[0] as unknown as { receive(f: string, m: unknown): void }).receive('n1', { t: 'chat', id: 'n1', name: 'x', text: '\u0007hi\n'.repeat(100) });
  });
});
