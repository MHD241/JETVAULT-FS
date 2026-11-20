// Browser transport for multiplayer: WebRTC data channels through PeerJS. The public PeerJS broker (0.peerjs.com) only introduces the peers (it sees the
// room code, the random peer ids and the IP addresses); game data goes peer to peer. Players connect to the host, which relays (see multiplayer.ts).
// There is no TURN server, so two players who are both behind strict NATs may fail to connect.
import type { Msg, Transport } from './multiplayer';

const PREFIX = 'jetvault-fs-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const validCode = (c: string) => new RegExp(`^[${ALPHABET}]{5}$`).test(c);

interface Conn { peer: string; send(d: unknown): void; close(): void; on(ev: string, cb: (...a: never[]) => void): void; open: boolean }
interface PeerLike { id: string; on(ev: string, cb: (...a: never[]) => void): void; connect(id: string, o?: unknown): Conn; destroy(): void }

class PeerTransport implements Transport {
  onMessage: ((from: string, msg: Msg) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onClosed: (() => void) | null = null;
  private conns = new Map<string, Conn>();
  constructor(private peer: PeerLike, public id: string, private host: boolean) {}
  /** Host: a client connected. */
  addClient(c: Conn) {
    this.conns.set(c.peer, c);
    c.on('data', ((d: { t?: string }) => {
      if (!d || typeof d !== 'object') return;
      this.onMessage?.(c.peer, d as Msg);                                              // for the host itself
      for (const [id, o] of this.conns) if (id !== c.peer && o.open) o.send({ from: c.peer, msg: d });   // relay to the other clients
    }) as never);
    c.on('close', (() => { this.conns.delete(c.peer); this.onPeerLeave?.(c.peer); for (const o of this.conns.values()) if (o.open) o.send({ from: c.peer, msg: { t: 'leave', id: c.peer } }); }) as never);
  }
  /** Client: the connection to the host. */
  setHost(c: Conn) {
    this.conns.set(c.peer, c);
    c.on('data', ((d: { from?: string; msg?: Msg }) => { if (d && typeof d.from === 'string' && d.msg) this.onMessage?.(d.from, d.msg); }) as never);
    c.on('close', (() => { this.conns.delete(c.peer); this.onPeerLeave?.(c.peer); this.onClosed?.(); }) as never);
  }
  send(msg: Msg) {
    if (this.host) { for (const o of this.conns.values()) if (o.open) o.send({ from: this.id, msg }); }
    else for (const o of this.conns.values()) if (o.open) o.send(msg);
  }
  close() { for (const o of this.conns.values()) try { o.close(); } catch { /* ignore */ } this.conns.clear(); try { this.peer.destroy(); } catch { /* ignore */ } }
}

export type RoomTransport = Transport & { onClosed: (() => void) | null };

/** Opens a room as its host; resolves with the transport and the room code. Retries with a new code if the code is taken. */
export async function hostRoom(): Promise<{ net: RoomTransport; code: string }> {
  const { Peer } = await import('peerjs');
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newCode();
    try {
      const peer = new Peer(PREFIX + code) as unknown as PeerLike;
      const net: PeerTransport = await new Promise((res, rej) => {
        const t = setTimeout(() => { try { peer.destroy(); } catch { /* ignore */ } rej(new Error('timeout')); }, 12000);
        peer.on('open', ((id: string) => { clearTimeout(t); const n = new PeerTransport(peer, id, true); peer.on('connection', ((c: Conn) => n.addClient(c)) as never); res(n); }) as never);
        peer.on('error', ((e: { type?: string }) => { clearTimeout(t); rej(new Error(e?.type ?? 'error')); }) as never);
      });
      return { net, code };
    } catch (e) { if ((e as Error).message !== 'unavailable-id') throw e; }
  }
  throw new Error('no free room code');
}

/** Joins the room with this code; rejects with a readable message if it cannot connect. */
export async function joinRoom(code: string): Promise<RoomTransport> {
  const { Peer } = await import('peerjs');
  const peer = new Peer() as unknown as PeerLike;
  return new Promise((res, rej) => {
    const fail = (m: string) => { clearTimeout(t); try { peer.destroy(); } catch { /* ignore */ } rej(new Error(m)); };
    const t = setTimeout(() => fail('Could not connect (timed out). The host may have closed the room, or the network blocks direct connections.'), 15000);
    peer.on('error', ((e: { type?: string }) => fail(e?.type === 'peer-unavailable' ? 'No room with that code.' : `Connection error (${e?.type ?? 'unknown'}).`)) as never);
    peer.on('open', ((id: string) => {
      const c = peer.connect(PREFIX + code);
      const n = new PeerTransport(peer, id, false);
      c.on('open', (() => { clearTimeout(t); n.setHost(c); res(n); }) as never);
    }) as never);
  });
}
