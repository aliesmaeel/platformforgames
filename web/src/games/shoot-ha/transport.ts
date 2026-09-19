import { API_BASE, wsUrl } from '../../platform/endpoints';

/**
 * How two Shoot-ha players find each other. Both transports speak the same
 * message shapes, so the game does not care which one is underneath:
 *
 * - relay: our WebSocket room on the score service (dev, or VITE_PFG_API set)
 * - peer:  WebRTC straight between the two browsers, with PeerJS's public
 *          signalling server exchanging the 4-letter code — works on a static
 *          host like Vercel with no server of our own
 */

export type NetMessage =
  | { type: 'hosted'; code: string }
  | { type: 'start'; side: number; names: string[]; first: number }
  | { type: 'relay'; payload: Record<string, unknown> }
  | { type: 'left' }
  | { type: 'error'; message: string };

export interface Transport {
  kind: 'relay' | 'peer';
  host(name: string): void;
  join(code: string, name: string): void;
  send(payload: Record<string, unknown>): void;
  close(): void;
}

type Listener = (m: NetMessage) => void;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'anon';

/** Pick a transport: `?net=peer|relay` forces one; otherwise relay when a server is reachable, else peer. */
export async function createTransport(onMessage: Listener): Promise<Transport> {
  const forced = new URLSearchParams(location.search).get('net');
  const useRelay = forced === 'relay' || (forced !== 'peer' && (Boolean(API_BASE) || import.meta.env.DEV));
  if (useRelay) return new RelayTransport(onMessage);
  const { Peer } = await import('peerjs');
  return new PeerTransport(onMessage, Peer);
}

// ---------- relay ----------

class RelayTransport implements Transport {
  kind = 'relay' as const;
  private ws: WebSocket | null = null;

  constructor(private emit: Listener) {}

  private open(first: Record<string, unknown>): void {
    this.close();
    const ws = new WebSocket(wsUrl('/ws/shoot-ha'));
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onmessage = (ev) => this.emit(JSON.parse(String(ev.data)) as NetMessage);
    ws.onerror = () =>
      this.emit({
        type: 'error',
        message: `Could not reach the match server at ${new URL(ws.url).host}. It needs the score service running, and both players must open the same site address.`
      });
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.emit({ type: 'left' });
      }
    };
  }

  host(name: string): void {
    this.open({ type: 'host', name });
  }

  join(code: string, name: string): void {
    this.open({ type: 'join', code, name });
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'relay', payload }));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

// ---------- peer to peer ----------

type PeerCtor = typeof import('peerjs').Peer;
type PeerInstance = InstanceType<PeerCtor>;
type Conn = import('peerjs').DataConnection;

const PREFIX = 'pfg-shootha-';
const JOIN_TIMEOUT_MS = 12000;

class PeerTransport implements Transport {
  kind = 'peer' as const;
  private peer: PeerInstance | null = null;
  private conn: Conn | null = null;
  private side = -1;
  private names = ['', ''];
  private rematch = new Set<number>();
  private timer = 0;

  constructor(private emit: Listener, private Peer: PeerCtor) {}

  host(name: string): void {
    this.close();
    this.side = 0;
    this.names = [cleanName(name), ''];
    this.listen(randomCode(), 0);
  }

  /** Claim a code on the signalling server; if it is taken, try another. */
  private listen(code: string, attempt: number): void {
    const peer = new this.Peer(PREFIX + code);
    this.peer = peer;
    peer.on('open', () => this.emit({ type: 'hosted', code }));
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'unavailable-id' && attempt < 5) {
        peer.destroy();
        this.listen(randomCode(), attempt + 1);
      } else {
        this.emit({ type: 'error', message: this.describe(err) });
      }
    });
    peer.on('connection', (conn) => {
      if (this.conn) {
        conn.on('open', () => conn.close());
        return;
      }
      this.attach(conn);
    });
  }

  join(code: string, name: string): void {
    this.close();
    this.side = 1;
    this.names = ['', cleanName(name)];
    const peer = new this.Peer();
    this.peer = peer;
    this.timer = window.setTimeout(() => {
      if (!this.conn?.open) this.emit({ type: 'error', message: 'No match with that code, or the host could not be reached.' });
    }, JOIN_TIMEOUT_MS);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      this.attach(conn);
      conn.on('open', () => conn.send({ type: 'join', name: this.names[1] }));
    });
    peer.on('error', (err: { type?: string; message?: string }) => this.emit({ type: 'error', message: this.describe(err) }));
  }

  private attach(conn: Conn): void {
    this.conn = conn;
    conn.on('data', (raw) => this.onData(raw as Record<string, unknown>));
    conn.on('close', () => {
      if (this.conn === conn) {
        this.conn = null;
        this.emit({ type: 'left' });
      }
    });
    conn.on('error', () => this.emit({ type: 'error', message: 'The connection to the other player failed.' }));
  }

  private onData(msg: Record<string, unknown>): void {
    if (msg.type === 'join' && this.side === 0) {
      this.names[1] = cleanName(msg.name);
      this.begin();
    } else if (msg.type === 'start' && this.side === 1) {
      clearTimeout(this.timer);
      this.names = msg.names as string[];
      this.emit({ type: 'start', side: 1, names: this.names, first: msg.first as number });
    } else if (msg.type === 'relay') {
      const payload = msg.payload as Record<string, unknown>;
      if (payload.kind === 'rematch' && this.side === 0) this.wantRematch(1);
      else this.emit({ type: 'relay', payload });
    }
  }

  /** Host decides kick-off and tells both sides. */
  private begin(): void {
    this.rematch.clear();
    const first = Math.random() < 0.5 ? 0 : 1;
    this.conn?.send({ type: 'start', side: 1, names: this.names, first });
    this.emit({ type: 'start', side: 0, names: this.names, first });
  }

  private wantRematch(side: number): void {
    this.rematch.add(side);
    if (this.rematch.size === 2) this.begin();
  }

  send(payload: Record<string, unknown>): void {
    if (payload.kind === 'rematch' && this.side === 0) {
      this.wantRematch(0);
      return;
    }
    if (this.conn?.open) this.conn.send({ type: 'relay', payload });
  }

  close(): void {
    clearTimeout(this.timer);
    const peer = this.peer;
    this.peer = null;
    this.conn = null;
    this.rematch.clear();
    peer?.destroy();
  }

  private describe(err: { type?: string; message?: string }): string {
    switch (err.type) {
      case 'peer-unavailable':
        return 'No match with that code. Check it with the host.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        return 'Could not reach the matchmaking service. Check your connection and try again.';
      case 'browser-incompatible':
        return 'This browser cannot make peer-to-peer connections.';
      default:
        return err.message ? `Connection problem: ${err.message}` : 'Connection problem.';
    }
  }
}
