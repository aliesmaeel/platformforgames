/**
 * Knockabout's authoritative simulation: circles on a shrinking disc push
 * each other; whoever leaves the disc is knocked out. Pure and tick-driven so
 * it can be tested without sockets.
 */

export const ROUND_S = 60;
export const RESULTS_S = 6;
export const MIN_PLAYERS = 4;
const RADIUS_START = 12;
const RADIUS_END = 5;
const PLAYER_R = 0.7;
const ACCEL = 38;
const FRICTION = 4.5;
const MAX_SPEED = 9;
const DASH_SPEED = 22;
const DASH_S = 0.18;
const DASH_COOLDOWN_S = 1.6;
const PUSH = 1.15; // bounce factor on contact
const RESPAWN_S = 2.5;
const CREDIT_S = 2.5;

const COLOURS = [0xf72585, 0x4cc9f0, 0xffd166, 0x8ac926, 0xa78bfa, 0xff9f1c, 0x5eead4, 0xfb7185];

export function createArena(now = 0) {
  return {
    players: new Map(),
    phase: 'waiting', // waiting | round | results
    phaseStart: now,
    time: now,
    radius: RADIUS_START,
    nextColour: 0,
    seq: 0
  };
}

const rand = (n) => (Math.random() - 0.5) * 2 * n;

function spawnPoint(arena) {
  const a = Math.random() * Math.PI * 2;
  const r = arena.radius * 0.55;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

export function addPlayer(arena, id, name, bot = false) {
  const p = {
    id,
    name,
    bot,
    colour: COLOURS[arena.nextColour++ % COLOURS.length],
    x: 0, z: 0, vx: 0, vz: 0,
    input: { dx: 0, dz: 0, dash: false },
    dashUntil: 0,
    dashReady: 0,
    alive: true,
    respawnAt: 0,
    kos: 0,
    falls: 0,
    lastHitBy: null,
    lastHitAt: -Infinity
  };
  Object.assign(p, spawnPoint(arena));
  arena.players.set(id, p);
  return p;
}

export function removePlayer(arena, id) {
  arena.players.delete(id);
}

export function setInput(arena, id, input) {
  const p = arena.players.get(id);
  if (!p) return;
  const len = Math.hypot(input.dx ?? 0, input.dz ?? 0) || 1;
  const scale = len > 1 ? 1 / len : 1;
  p.input = { dx: (input.dx ?? 0) * scale, dz: (input.dz ?? 0) * scale, dash: Boolean(input.dash) };
}

export function humanCount(arena) {
  let n = 0;
  for (const p of arena.players.values()) if (!p.bot) n++;
  return n;
}

/** Keep the arena populated with bots up to MIN_PLAYERS while humans are present. */
export function balanceBots(arena) {
  const humans = humanCount(arena);
  const bots = [...arena.players.values()].filter((p) => p.bot);
  if (humans === 0) {
    for (const b of bots) arena.players.delete(b.id);
    return;
  }
  let need = MIN_PLAYERS - arena.players.size;
  let i = bots.length;
  while (need-- > 0) addPlayer(arena, `bot-${++i}-${Math.floor(Math.random() * 1e4)}`, ['Rook', 'Pip', 'Moss', 'Bramble', 'Quill', 'Fen'][i % 6], true);
  // Too many bots when humans join: drop extras.
  while (arena.players.size > MIN_PLAYERS && bots.length) {
    const b = bots.pop();
    if (arena.players.size > MIN_PLAYERS) arena.players.delete(b.id);
  }
}

function botThink(arena, bot) {
  let target = null;
  let best = Infinity;
  for (const p of arena.players.values()) {
    if (p === bot || !p.alive) continue;
    const d = Math.hypot(p.x - bot.x, p.z - bot.z);
    if (d < best) {
      best = d;
      target = p;
    }
  }
  const edge = Math.hypot(bot.x, bot.z) / arena.radius;
  let dx = 0;
  let dz = 0;
  if (edge > 0.7) {
    // Head back toward the middle when near the edge.
    dx = -bot.x;
    dz = -bot.z;
  } else if (target) {
    dx = target.x - bot.x;
    dz = target.z - bot.z;
  }
  const len = Math.hypot(dx, dz) || 1;
  bot.input = { dx: dx / len, dz: dz / len, dash: Boolean(target) && best < 3.2 && edge < 0.75 && Math.random() < 0.08 };
}

export function startRound(arena) {
  arena.phase = 'round';
  arena.phaseStart = arena.time;
  arena.radius = RADIUS_START;
  for (const p of arena.players.values()) {
    Object.assign(p, spawnPoint(arena), { vx: 0, vz: 0, alive: true, kos: 0, falls: 0, dashUntil: 0, dashReady: 0, lastHitBy: null });
  }
}

export function step(arena, dt) {
  arena.time += dt;
  arena.seq++;
  const elapsed = arena.time - arena.phaseStart;
  const roundS = arena.roundSeconds ?? ROUND_S;

  if (arena.phase === 'waiting') {
    if (arena.players.size >= 2) startRound(arena);
    return;
  }
  if (arena.phase === 'results') {
    if (elapsed >= RESULTS_S) {
      if (arena.players.size >= 2) startRound(arena);
      else arena.phase = 'waiting';
    }
    return;
  }

  // Round in progress.
  arena.radius = RADIUS_START + (RADIUS_END - RADIUS_START) * Math.min(1, elapsed / roundS);
  for (const p of arena.players.values()) if (p.bot && p.alive) botThink(arena, p);

  for (const p of arena.players.values()) {
    if (!p.alive) {
      if (arena.time >= p.respawnAt && roundS - elapsed > 3) {
        Object.assign(p, spawnPoint(arena), { vx: 0, vz: 0, alive: true, lastHitBy: null });
      }
      continue;
    }
    const dashing = arena.time < p.dashUntil;
    if (p.input.dash && arena.time >= p.dashReady && !dashing && (p.input.dx || p.input.dz)) {
      p.dashUntil = arena.time + DASH_S;
      p.dashReady = arena.time + DASH_COOLDOWN_S;
      p.vx = p.input.dx * DASH_SPEED;
      p.vz = p.input.dz * DASH_SPEED;
    }
    if (!dashing) {
      p.vx += p.input.dx * ACCEL * dt;
      p.vz += p.input.dz * ACCEL * dt;
      p.vx -= p.vx * FRICTION * dt;
      p.vz -= p.vz * FRICTION * dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > MAX_SPEED) {
        p.vx = (p.vx / sp) * MAX_SPEED;
        p.vz = (p.vz / sp) * MAX_SPEED;
      }
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
  }

  // Collisions: separate and exchange velocity along the contact normal.
  const alive = [...arena.players.values()].filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const min = PLAYER_R * 2;
      if (dist >= min) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = min - dist;
      a.x -= nx * overlap / 2;
      a.z -= nz * overlap / 2;
      b.x += nx * overlap / 2;
      b.z += nz * overlap / 2;
      const va = a.vx * nx + a.vz * nz;
      const vb = b.vx * nx + b.vz * nz;
      const rel = va - vb;
      if (rel > 0) {
        const impulse = rel * PUSH;
        a.vx -= nx * impulse;
        a.vz -= nz * impulse;
        b.vx += nx * impulse;
        b.vz += nz * impulse;
        // The faster mover gets credit for the shove.
        const shover = Math.abs(va) >= Math.abs(vb) ? a : b;
        const shoved = shover === a ? b : a;
        shoved.lastHitBy = shover.id;
        shoved.lastHitAt = arena.time;
      }
    }
  }

  // Falls.
  for (const p of alive) {
    if (Math.hypot(p.x, p.z) <= arena.radius + PLAYER_R * 0.4) continue;
    p.alive = false;
    p.falls++;
    p.respawnAt = arena.time + RESPAWN_S;
    const credit = arena.time - p.lastHitAt <= CREDIT_S ? arena.players.get(p.lastHitBy) : null;
    if (credit) credit.kos++;
  }

  if (elapsed >= roundS) {
    arena.phase = 'results';
    arena.phaseStart = arena.time;
  }
}

export function snapshot(arena) {
  return {
    seq: arena.seq,
    phase: arena.phase,
    t: Math.round((arena.time - arena.phaseStart) * 100) / 100,
    radius: Math.round(arena.radius * 100) / 100,
    players: [...arena.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      colour: p.colour,
      x: Math.round(p.x * 100) / 100,
      z: Math.round(p.z * 100) / 100,
      alive: p.alive,
      dashing: arena.time < p.dashUntil,
      kos: p.kos,
      falls: p.falls
    }))
  };
}

export { rand as _rand };
