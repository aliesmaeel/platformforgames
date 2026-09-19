import { createServer } from 'node:http';
import { addScore, topScores } from './db.js';
import { createKnockaboutRoom, routeUpgrades } from './knockabout.js';
import { createShoothaRoom } from './shootha.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 4 * 1024;

const send = (res, status, body) => {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end(json);
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

const cleanName = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24) || 'anon';

const isGameId = (value) => /^[a-z0-9-]{1,40}$/.test(value);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET' && path === '/api/health') {
    return send(res, 200, { ok: true });
  }

  // GET /api/scores/:gameId?limit=10
  const board = path.match(/^\/api\/scores\/([^/]+)$/);
  if (req.method === 'GET' && board) {
    const gameId = decodeURIComponent(board[1]);
    if (!isGameId(gameId)) return send(res, 400, { error: 'bad game id' });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 50);
    return send(res, 200, { gameId, scores: topScores(gameId, limit) });
  }

  // POST /api/scores  { gameId, player, score }
  if (req.method === 'POST' && path === '/api/scores') {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    const gameId = String(body.gameId ?? '');
    const score = Math.floor(Number(body.score));
    if (!isGameId(gameId)) return send(res, 400, { error: 'bad game id' });
    if (!Number.isFinite(score) || score < 0 || score > 1e9) {
      return send(res, 400, { error: 'bad score' });
    }
    const player = cleanName(body.player);
    return send(res, 201, { gameId, player, score, ...addScore(gameId, player, score) });
  }

  send(res, 404, { error: 'not found' });
});

routeUpgrades(server, {
  '/ws/knockabout': createKnockaboutRoom({ roundSeconds: Number(process.env.PFG_ROUND_S) || undefined }).wss,
  '/ws/shoot-ha': createShoothaRoom().wss
});

server.listen(PORT, () => {
  console.log(`[pfg] score service + game rooms on http://localhost:${PORT}`);
});
