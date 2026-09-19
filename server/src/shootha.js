import { WebSocketServer } from 'ws';

/**
 * Shoot-ha online rooms. The server only pairs two players by a short code
 * and relays their shots; both browsers run the same deterministic
 * simulation, and every shot carries the shooter's positions so they cannot
 * drift apart.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RELAYED = new Set(['shot', 'timeout', 'rematch']);

const cleanName = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24) || 'anon';

const send = (ws, payload) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
};

export function createShoothaRoom() {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map(); // code -> { players: [ws, ws|null], names, rematch: Set }

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };

  const start = (room) => {
    room.rematch = new Set();
    const first = Math.random() < 0.5 ? 0 : 1;
    room.players.forEach((ws, side) => send(ws, { type: 'start', side, names: room.names, first }));
  };

  wss.on('connection', (ws) => {
    let room = null;
    let side = -1;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw).slice(0, 8192));
      } catch {
        return;
      }
      if (msg.type === 'host' && !room) {
        const code = newCode();
        room = { code, players: [ws, null], names: [cleanName(msg.name), ''], rematch: new Set() };
        side = 0;
        rooms.set(code, room);
        send(ws, { type: 'hosted', code });
      } else if (msg.type === 'join' && !room) {
        const target = rooms.get(String(msg.code ?? '').toUpperCase());
        if (!target || target.players[1]) {
          send(ws, { type: 'error', message: target ? 'That match is already full' : 'No match with that code' });
          return;
        }
        room = target;
        side = 1;
        room.players[1] = ws;
        room.names[1] = cleanName(msg.name);
        start(room);
      } else if (msg.type === 'relay' && room && msg.payload && RELAYED.has(msg.payload.kind)) {
        if (msg.payload.kind === 'rematch') {
          room.rematch.add(side);
          if (room.rematch.size === 2 && room.players.every(Boolean)) start(room);
          return;
        }
        send(room.players[1 - side], { type: 'relay', payload: msg.payload });
      }
    });

    ws.on('close', () => {
      if (!room) return;
      const other = room.players[1 - side];
      room.players[side] = null;
      send(other, { type: 'left' });
      if (!room.players.some(Boolean)) rooms.delete(room.code);
    });
    ws.on('error', () => ws.close());
  });

  return { wss, rooms };
}
