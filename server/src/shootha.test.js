import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createShoothaRoom } from './shootha.js';
import { routeUpgrades } from './knockabout.js';

const http = createServer();
const room = createShoothaRoom();
routeUpgrades(http, { '/ws/shoot-ha': room.wss });
await new Promise((r) => http.listen(0, r));
const port = http.address().port;

const connect = () =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/shoot-ha`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      const w = waiters.shift();
      if (w) w(msg);
      else inbox.push(msg);
    });
    ws.next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r)));
    ws.on('open', () => resolve(ws));
  });

const a = await connect();
a.send(JSON.stringify({ type: 'host', name: 'Ali' }));
const hosted = await a.next();
assert.equal(hosted.type, 'hosted');
assert.match(hosted.code, /^[A-Z2-9]{4}$/);

// wrong code is refused
const stranger = await connect();
stranger.send(JSON.stringify({ type: 'join', code: 'ZZZZ', name: 'Nobody' }));
assert.equal((await stranger.next()).type, 'error');
stranger.close();

const b = await connect();
b.send(JSON.stringify({ type: 'join', code: hosted.code.toLowerCase(), name: '<Bo>' }));
const [sa, sb] = await Promise.all([a.next(), b.next()]);
assert.equal(sa.type, 'start');
assert.equal(sa.side, 0);
assert.equal(sb.side, 1);
assert.deepEqual(sa.names, ['Ali', 'Bo']);
assert.equal(sa.first, sb.first);

// a third player cannot join a full room
const c = await connect();
c.send(JSON.stringify({ type: 'join', code: hosted.code, name: 'Cy' }));
assert.match((await c.next()).message, /full/);
c.close();

// shots relay to the other side only, unknown kinds are dropped
a.send(JSON.stringify({ type: 'relay', payload: { kind: 'shot', disc: 3, vx: 900, vy: -10, snap: { bodies: [] } } }));
const relayed = await b.next();
assert.equal(relayed.type, 'relay');
assert.equal(relayed.payload.vx, 900);
a.send(JSON.stringify({ type: 'relay', payload: { kind: 'evil' } }));
b.send(JSON.stringify({ type: 'relay', payload: { kind: 'timeout', team: 1 } }));
assert.equal((await a.next()).payload.kind, 'timeout');

// rematch needs both sides, then restarts with sides kept
a.send(JSON.stringify({ type: 'relay', payload: { kind: 'rematch' } }));
b.send(JSON.stringify({ type: 'relay', payload: { kind: 'rematch' } }));
const [ra, rb] = await Promise.all([a.next(), b.next()]);
assert.equal(ra.type, 'start');
assert.equal(rb.side, 1);

// leaving tells the other side and empties the room
b.close();
assert.equal((await a.next()).type, 'left');
a.close();
await new Promise((r) => setTimeout(r, 50));
assert.equal(room.rooms.size, 0);
http.close();
console.log('shootha.test.js: all assertions passed');
