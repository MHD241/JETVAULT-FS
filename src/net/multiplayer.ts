// Multiplayer: players share one sky. Each client flies its own aircraft with its own flight model and sends its pose about 10 times a second;
// everybody sees the others as ghost aircraft (no collisions between players). Topology: one player hosts a room, the others connect to the host,
// which relays everything (a star, so a room never needs more than N-1 connections on the host). Everything arriving from the network is untrusted:
// it is validated and clamped before use. The transport is abstract so the logic is tested without a network (net/transport.ts has the browser one).

export interface PlayerState {
  /** Name (max 16 printable characters), aircraft id, position NED (m, local frame), attitude quaternion (w, x, y, z), velocity NED (m/s). */
  name: string; ac: string; p: [number, number, number]; q: [number, number, number, number]; v: [number, number, number];
  /** Selected controls shown on the model. */
  gear: number; flap: number; lights: number;
}
export interface WeatherShare { dayOfYear: number; timeOfDay: number; cloudCover: string; windDirection: number; windSpeed: number; qnh: number; temperatureC: number }
export type Msg =
  | { t: 'hello'; id: string; name: string }
  | { t: 'state'; id: string; s: PlayerState; n: number }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'leave'; id: string }
  | { t: 'weather'; w: WeatherShare }
  | { t: 'roster'; ids: { id: string; name: string }[] };

export interface Transport {
  /** Own id in the room. */
  id: string;
  /** Sends to everybody else in the room (the host relays). */
  send(msg: Msg): void;
  onMessage: ((from: string, msg: Msg) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  close(): void;
}

export const MAX_PLAYERS = 8;
export const SEND_HZ = 10;

const num = (x: unknown, lim = 1e7): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-lim, Math.min(lim, x)) : 0);
export function cleanName(n: unknown): string {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return s || 'Pilot';
}
/** Validates and clamps a received state; returns null if it is not a state at all. */
export function cleanState(s: unknown): PlayerState | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const arr = (a: unknown, n: number, lim: number): number[] | null => (Array.isArray(a) && a.length === n ? a.map((x) => num(x, lim)) : null);
  const p = arr(o.p, 3, 2e6), q = arr(o.q, 4, 1.01), v = arr(o.v, 3, 400);
  if (!p || !q || !v) return null;
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 0.5) return null;
  return { name: cleanName(o.name), ac: typeof o.ac === 'string' ? o.ac.slice(0, 12).replace(/[^a-z0-9]/gi, '') : 'a320', p: p as [number, number, number],
    q: q.map((x) => x / n) as [number, number, number, number], v: v as [number, number, number], gear: Math.max(0, Math.min(1, num(o.gear, 1))), flap: Math.max(0, Math.min(1, num(o.flap, 1))), lights: Math.max(0, Math.min(255, Math.round(num(o.lights, 255)))) };
}

interface Remote { id: string; name: string; last: PlayerState | null; prev: PlayerState | null; tLast: number; tPrev: number; seq: number }

/** Smoothed pose of a remote player for the renderer: dead-reckoned from the last state, blended toward it. */
export interface RemotePose { id: string; name: string; ac: string; p: [number, number, number]; q: [number, number, number, number]; gear: number; flap: number; lights: number }

export class Multiplayer {
  players = new Map<string, Remote>();
  private sendTimer = 0; private seq = 0;
  onRoster: (() => void) | null = null;
  onChat: ((name: string, text: string) => void) | null = null;
  onWeather: ((w: WeatherShare) => void) | null = null;
  /** The host's current weather, sent to every player who joins. */
  getWeather: (() => WeatherShare) | null = null;
  isHost = false;
  constructor(public net: Transport, public name: string, host: boolean, private now: () => number = () => performance.now() / 1000) {
    this.name = cleanName(name); this.isHost = host;
    net.onMessage = (from, m) => this.receive(from, m);
    net.onPeerLeave = (id) => { if (this.players.delete(id)) this.onRoster?.(); };
    net.send({ t: 'hello', id: net.id, name: this.name });
  }
  get id() { return this.net.id; }
  get roster() { return [{ id: this.id, name: this.name, me: true }, ...[...this.players.values()].map((r) => ({ id: r.id, name: r.name, me: false }))]; }

  private receive(from: string, m: Msg) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.players.size + 1 >= MAX_PLAYERS && !this.players.has(from)) return;
      const known = this.players.has(from);
      const r = this.players.get(from) ?? { id: from, name: '', last: null, prev: null, tLast: 0, tPrev: 0, seq: -1 };
      r.name = cleanName(m.name); this.players.set(from, r); this.onRoster?.();
      if (!known) this.net.send({ t: 'hello', id: this.id, name: this.name });   // introduce ourselves to the newcomer (others already know us and stay quiet)
      if (this.isHost && this.getWeather) this.net.send({ t: 'weather', w: this.getWeather() });   // the host tells the newcomer (and everyone) the sky
    } else if (m.t === 'state') {
      const s = cleanState(m.s);
      let r = this.players.get(from);
      if (!r && s && this.players.size + 1 < MAX_PLAYERS) { r = { id: from, name: s.name, last: null, prev: null, tLast: 0, tPrev: 0, seq: -1 }; this.players.set(from, r); this.onRoster?.(); }
      if (!r || !s || !Number.isFinite(m.n) || m.n <= r.seq) return;   // unknown sender, bad data, or an old packet
      r.seq = m.n; r.prev = r.last; r.tPrev = r.tLast; r.last = s; r.tLast = this.now(); r.name = s.name;
    } else if (m.t === 'chat') {
      const text = String(m.text ?? '').slice(0, 200).replace(/[\u0000-\u001f]/g, ' ');
      if (text.trim()) this.onChat?.(this.players.get(from)?.name ?? cleanName(m.name), text);
    } else if (m.t === 'leave') {
      if (this.players.delete(from)) this.onRoster?.();
    } else if (m.t === 'weather') {
      if (!this.isHost) { const w = m.w; if (w && typeof w === 'object') this.onWeather?.({ dayOfYear: Math.round(num(w.dayOfYear, 366)), timeOfDay: num(w.timeOfDay, 24), cloudCover: String(w.cloudCover).slice(0, 4), windDirection: num(w.windDirection, 360), windSpeed: num(w.windSpeed, 150), qnh: Math.max(900, Math.min(1100, num(w.qnh, 1100))), temperatureC: num(w.temperatureC, 60) }); }
    }
  }

  say(text: string) { text = text.slice(0, 200); if (text.trim()) { this.net.send({ t: 'chat', id: this.id, name: this.name, text }); this.onChat?.(this.name, text); } }

  /** Call every frame with the time step and the local aircraft; sends a state at SEND_HZ. */
  update(dt: number, mine: () => PlayerState | null) {
    this.sendTimer += dt;
    if (this.sendTimer < 1 / SEND_HZ) return;
    this.sendTimer = 0;
    const s = mine(); if (s) this.net.send({ t: 'state', id: this.id, s: { ...s, name: this.name }, n: ++this.seq });
  }

  /** Poses to draw now: dead reckoning from the last state with its velocity (at most 0.6 s ahead). */
  poses(): RemotePose[] {
    const t = this.now(), out: RemotePose[] = [];
    for (const r of this.players.values()) {
      const s = r.last; if (!s || t - r.tLast > 15) continue;   // silent for 15 s: not drawn
      const dt = Math.min(0.6, Math.max(0, t - r.tLast));
      out.push({ id: r.id, name: r.name, ac: s.ac, p: [s.p[0] + s.v[0] * dt, s.p[1] + s.v[1] * dt, s.p[2] + s.v[2] * dt], q: s.q, gear: s.gear, flap: s.flap, lights: s.lights });
    }
    return out;
  }
  leave() { this.net.send({ t: 'leave', id: this.id }); this.net.close(); this.players.clear(); }
}

/** In-memory star network for tests: one host, any number of clients; the host relays like the real transport. */
export class MemoryHub {
  nodes = new Map<string, MemoryNode>(); hostId = '';
  node(id: string, host = false): MemoryNode { const n = new MemoryNode(this, id); this.nodes.set(id, n); if (host) this.hostId = id; return n; }
}
export class MemoryNode implements Transport {
  onMessage: ((from: string, msg: Msg) => void) | null = null; onPeerLeave: ((id: string) => void) | null = null;
  constructor(private hub: MemoryHub, public id: string) {}
  send(msg: Msg) {
    const host = this.hub.hostId;
    const deliver = (to: string) => { const n = this.hub.nodes.get(to); if (n && to !== this.id) n.onMessage?.(this.id, JSON.parse(JSON.stringify(msg))); };
    if (this.id === host) for (const id of this.hub.nodes.keys()) deliver(id);
    else { deliver(host); for (const id of this.hub.nodes.keys()) if (id !== host) deliver(id); }   // the host relays to the rest
  }
  close() { this.hub.nodes.delete(this.id); for (const n of this.hub.nodes.values()) n.onPeerLeave?.(this.id); }
}
