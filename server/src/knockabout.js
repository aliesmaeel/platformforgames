import { WebSocketServer } from 'ws';
import * as A from './arena.js';

/**
 * WebSocket room for Knockabout. One arena per server; humans join it, bots
 * fill the gaps. The server simulates at TICK_HZ and broadcasts snapshots;
 * clients only send intent.
 */

const TICK_HZ = 20;
const PATH = '/ws/knockabout';

const cleanName = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24) || 'anon';

export function attachKnockabout(httpServer, { roundSeconds } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const arena = A.createArena();
  if (roundSeconds) arena.roundSeconds = roundSeconds;
  const sockets = new Map(); // id -> ws
  let nextId = 1;
  let lastPhase = arena.phase;

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const id = `p${nextId++}`;
    let joined = false;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw).slice(0, 512));
      } catch {
        return;
      }
      if (msg.type === 'join' && !joined) {
        joined = true;
        A.addPlayer(arena, id, cleanName(msg.name));
        A.balanceBots(arena);
        sockets.set(id, ws);
        ws.send(JSON.stringify({ type: 'welcome', id, roundSeconds: arena.roundSeconds ?? A.ROUND_S }));
      } else if (msg.type === 'input' && joined) {
        A.setInput(arena, id, { dx: Number(msg.dx) || 0, dz: Number(msg.dz) || 0, dash: Boolean(msg.dash) });
      }
    });

    ws.on('close', () => {
      sockets.delete(id);
      A.removePlayer(arena, id);
      A.balanceBots(arena);
    });
    ws.on('error', () => ws.close());
  });

  const broadcast = (payload) => {
    const data = JSON.stringify(payload);
    for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(data);
  };

  const timer = setInterval(() => {
    if (sockets.size === 0) return;
    A.step(arena, 1 / TICK_HZ);
    if (arena.phase === 'results' && lastPhase === 'round') {
      broadcast({
        type: 'results',
        players: [...arena.players.values()]
          .map((p) => ({ id: p.id, name: p.name, bot: p.bot, kos: p.kos, falls: p.falls }))
          .sort((a, b) => b.kos - a.kos || a.falls - b.falls)
      });
    }
    lastPhase = arena.phase;
    broadcast({ type: 'state', ...A.snapshot(arena) });
  }, 1000 / TICK_HZ);
  timer.unref();

  return { wss, arena, close: () => clearInterval(timer) };
}
