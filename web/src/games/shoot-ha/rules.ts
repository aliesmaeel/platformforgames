/**
 * Shoot-ha rules with no rendering: the pitch, disc/ball physics, goals,
 * the computer opponent, and the turn/clock/score state machine.
 */

export const W = 1000;
export const H = 600;
export const GOAL = 190;
export const DEPTH = 52;
export const PAD = 30;
export const VW = W + 2 * (DEPTH + PAD);
export const VH = H + 2 * PAD;
export const OX = DEPTH + PAD;
export const OY = PAD;
export const TOP = H / 2 - GOAL / 2;
export const BOT = H / 2 + GOAL / 2;
export const DISC_R = 26;
export const BALL_R = 13;
export const POST_R = 7;
export const MAXV = 1750;
export const MAXDRAG = 170;
export const TIME = 180;
export const WIN_GOALS = 2;
export const SIM_STEP = 1 / 240;

const FORM: [number, number][] = [[62, 300], [215, 165], [215, 435], [395, 222], [395, 378]];

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  damp: number;
  team: number; // 0 blue, 1 red, -1 ball
  ball: boolean;
  rot: number;
}

export interface World {
  bodies: Body[];
  ball: Body;
}

/** Collision sound hook: (volume 0..1, frequency). */
export type Sound = (vol: number, freq: number) => void;

const makeDisc = (team: number, x: number, y: number): Body => ({ x, y, vx: 0, vy: 0, r: DISC_R, m: 1, damp: 0.972, team, ball: false, rot: 0 });

export function createWorld(): World {
  const bodies: Body[] = [];
  for (const [x, y] of FORM) bodies.push(makeDisc(0, x, y));
  for (const [x, y] of FORM) bodies.push(makeDisc(1, W - x, y));
  const ball: Body = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: BALL_R, m: 0.45, damp: 0.983, team: -1, ball: true, rot: 0 };
  bodies.push(ball);
  return { bodies, ball };
}

function walls(b: Body, sound?: Sound): void {
  const inMouth = b.y > TOP && b.y < BOT;
  const clack = () => sound?.(Math.hypot(b.vx, b.vy) / 6000, 300);
  if (b.x < 0) {
    if (b.y - b.r < TOP) { b.y = TOP + b.r; b.vy = Math.abs(b.vy) * 0.6; }
    if (b.y + b.r > BOT) { b.y = BOT - b.r; b.vy = -Math.abs(b.vy) * 0.6; }
    if (b.x - b.r < -DEPTH) { b.x = -DEPTH + b.r; b.vx = Math.abs(b.vx) * 0.25; }
  } else if (b.x - b.r < 0 && !inMouth) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.72; clack(); }
  if (b.x > W) {
    if (b.y - b.r < TOP) { b.y = TOP + b.r; b.vy = Math.abs(b.vy) * 0.6; }
    if (b.y + b.r > BOT) { b.y = BOT - b.r; b.vy = -Math.abs(b.vy) * 0.6; }
    if (b.x + b.r > W + DEPTH) { b.x = W + DEPTH - b.r; b.vx = -Math.abs(b.vx) * 0.25; }
  } else if (b.x + b.r > W && !inMouth) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.72; clack(); }
  if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.72; clack(); }
  if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.72; clack(); }
  for (const [px, py] of POSTS) {
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const min = b.r + POST_R;
    if (d < min && d > 0) {
      const nx = dx / d;
      const ny = dy / d;
      b.x = px + nx * min;
      b.y = py + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= 1.7 * vn * nx;
        b.vy -= 1.7 * vn * ny;
        sound?.(-vn / 4000, 700);
      }
    }
  }
}

export const POSTS: [number, number][] = [[0, TOP], [0, BOT], [W, TOP], [W, BOT]];

function collide(a: Body, b: Body, sound?: Sound): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (d >= min || d === 0) return;
  const nx = dx / d;
  const ny = dy / d;
  const ima = 1 / a.m;
  const imb = 1 / b.m;
  const sum = ima + imb;
  const ov = min - d;
  a.x -= (nx * ov * ima) / sum;
  a.y -= (ny * ov * ima) / sum;
  b.x += (nx * ov * imb) / sum;
  b.y += (ny * ov * imb) / sum;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv < 0) {
    const e = a.ball || b.ball ? 0.9 : 0.85;
    const j = (-(1 + e) * rv) / sum;
    a.vx -= j * ima * nx;
    a.vy -= j * ima * ny;
    b.vx += j * imb * nx;
    b.vy += j * imb * ny;
    sound?.(-rv / 3500, a.ball || b.ball ? 1100 : 820);
  }
}

/** One physics sub-step. Returns the team that just scored, if the ball entered a goal. */
export function step(world: World, h: number, sound?: Sound): 0 | 1 | null {
  for (const b of world.bodies) {
    b.x += b.vx * h;
    b.y += b.vy * h;
    const k = Math.pow(b.damp, h * 60);
    b.vx *= k;
    b.vy *= k;
    const s = Math.hypot(b.vx, b.vy);
    if (s < 7) {
      b.vx = 0;
      b.vy = 0;
    }
    b.rot += (s * h) / b.r;
  }
  const bs = world.bodies;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) collide(bs[i], bs[j], sound);
  for (const b of bs) walls(b, sound);
  const ball = world.ball;
  if (ball.x + ball.r < 0) return 1;
  if (ball.x - ball.r > W) return 0;
  return null;
}

export const allRest = (world: World): boolean => world.bodies.every((b) => b.vx === 0 && b.vy === 0);

export function freeSpot(world: World, x: number, y: number): number {
  for (let k = 0; k < 40; k++) {
    const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 14;
    const ty = Math.min(H - DISC_R, Math.max(DISC_R, y + off));
    if (world.bodies.every((o) => Math.hypot(o.x - x, o.y - ty) >= o.r + DISC_R + 1)) return ty;
  }
  return y;
}

/** Discs that ended up inside a goal are moved back onto the pitch. */
export function fixDiscsInGoals(world: World): void {
  for (const b of world.bodies) {
    if (b.ball) continue;
    if (b.x < 0) {
      b.x = 80;
      b.y = -9999;
      b.y = freeSpot(world, 80, H / 2);
    } else if (b.x > W) {
      b.x = W - 80;
      b.y = -9999;
      b.y = freeSpot(world, W - 80, H / 2);
    }
  }
}

/** Velocity from a drag that started on the disc and ended at (px, py); null if too short. */
export function flick(disc: Body, px: number, py: number): { vx: number; vy: number } | null {
  const dx = disc.x - px;
  const dy = disc.y - py;
  const dist = Math.hypot(dx, dy);
  if (dist < 14) return null;
  const power = Math.min(dist, MAXDRAG) / MAXDRAG;
  return { vx: (dx / dist) * power * MAXV, vy: (dy / dist) * power * MAXV };
}

export function pickDisc(world: World, team: number, p: { x: number; y: number }): Body | null {
  let best: Body | null = null;
  let bd = 1e9;
  for (const b of world.bodies) {
    if (b.team !== team) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < b.r + 14 && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

// ---------- computer opponent ----------

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function aiShot(world: World, team: number, kickoffPending: boolean, rng: () => number = Math.random): { disc: Body; vx: number; vy: number } {
  const ball = world.ball;
  const gx = team === 0 ? W + 25 : -25;
  const gy = H / 2 + (rng() - 0.5) * GOAL * 0.4;
  const gdx = gx - ball.x;
  const gdy = gy - ball.y;
  const gl = Math.hypot(gdx, gdy);
  const ux = gdx / gl;
  const uy = gdy / gl;
  const laneBlock = world.bodies.filter((o) => !o.ball && segDist(o.x, o.y, ball.x, ball.y, gx, gy) < o.r + ball.r).length;
  let best: { d: Body; nx: number; ny: number; s: number; speed: number } | null = null;
  for (const d of world.bodies) {
    if (d.team !== team) continue;
    const tx = ball.x - ux * (d.r + ball.r - 3);
    const ty = ball.y - uy * (d.r + ball.r - 3);
    const vx = tx - d.x;
    const vy = ty - d.y;
    const dist = Math.hypot(vx, vy);
    if (dist < 1) continue;
    const nx = vx / dist;
    const ny = vy / dist;
    const cut = nx * ux + ny * uy;
    if (cut < 0.35) continue;
    if (world.bodies.some((o) => o !== d && o !== ball && segDist(o.x, o.y, d.x, d.y, tx, ty) < d.r + o.r - 2)) continue;
    const s = cut * 600 - dist * 0.5 - laneBlock * 120;
    if (!best || s > best.s) best = { d, nx, ny, s, speed: Math.min(MAXV, 650 + dist * 1.2 + gl * 0.9) };
  }
  if (!best) {
    let d: Body | null = null;
    let bd = 1e9;
    for (const o of world.bodies) {
      if (o.team !== team) continue;
      const k = Math.hypot(o.x - ball.x, o.y - ball.y);
      if (k < bd) {
        bd = k;
        d = o;
      }
    }
    const vx = ball.x - d!.x;
    const vy = ball.y - d!.y;
    const l = Math.hypot(vx, vy) || 1;
    best = { d: d!, nx: vx / l, ny: vy / l, s: 0, speed: MAXV * 0.75 };
  }
  if (kickoffPending) best.speed = Math.min(best.speed, 850);
  const a = Math.atan2(best.ny, best.nx) + (rng() - 0.5) * 0.06;
  return { disc: best.d, vx: Math.cos(a) * best.speed, vy: Math.sin(a) * best.speed };
}

// ---------- match state machine ----------

export type Mode = 'ai' | 'pvp';
export type State = 'idle' | 'aim' | 'sim' | 'pause' | 'over';

export type MatchEvent =
  | { type: 'goal'; team: number; final: boolean }
  | { type: 'nogoal' }
  | { type: 'turn'; team: number }
  | { type: 'over'; winner: number; why: 'goals' | 'time' };

export class Match {
  world = createWorld();
  state: State = 'idle';
  turn = 0;
  score = [0, 0];
  clocks = [TIME, TIME];
  kickoffPending = true;
  shotKick = false;
  shooter = 0;
  goalScored: 0 | 1 | null = null;
  goalAt = 0;
  simTime = 0;
  winner: number | null = null;
  private acc = 0;
  private after: (() => MatchEvent[]) | null = null;
  mode: Mode;

  constructor(mode: Mode) {
    this.mode = mode;
  }

  isHuman(team: number): boolean {
    return this.mode === 'pvp' || team === 0;
  }

  begin(first: number): MatchEvent[] {
    this.turn = first;
    this.kickoffPending = true;
    this.state = 'aim';
    return [{ type: 'turn', team: first }];
  }

  shoot(disc: Body, vx: number, vy: number): void {
    if (this.state !== 'aim' || disc.team !== this.turn) return;
    disc.vx = vx;
    disc.vy = vy;
    this.shotKick = this.kickoffPending;
    this.kickoffPending = false;
    this.shooter = this.turn;
    this.goalScored = null;
    this.simTime = 0;
    this.acc = 0;
    this.state = 'sim';
  }

  /** Advance clocks and simulation. Events tell the renderer what to show. */
  tick(dt: number, sound?: Sound): MatchEvent[] {
    if (this.state === 'aim') {
      this.clocks[this.turn] -= dt;
      if (this.clocks[this.turn] <= 0) {
        this.clocks[this.turn] = 0;
        return this.end(1 - this.turn, 'time');
      }
      return [];
    }
    if (this.state !== 'sim') return [];
    this.acc += dt;
    while (this.acc >= SIM_STEP) {
      const scored = step(this.world, SIM_STEP, sound);
      if (scored !== null && this.goalScored === null) {
        this.goalScored = scored;
        this.goalAt = this.simTime;
      }
      this.simTime += SIM_STEP;
      this.acc -= SIM_STEP;
    }
    const settled = allRest(this.world) || (this.goalScored !== null && this.simTime - this.goalAt > 1.3) || this.simTime > 12;
    if (!settled) return [];
    for (const b of this.world.bodies) {
      b.vx = 0;
      b.vy = 0;
    }
    return this.resolve();
  }

  private resolve(): MatchEvent[] {
    if (this.goalScored === null) {
      fixDiscsInGoals(this.world);
      this.turn = 1 - this.turn;
      this.state = 'aim';
      return [{ type: 'turn', team: this.turn }];
    }
    const g = this.goalScored;
    this.state = 'pause';
    if (this.shotKick) {
      this.after = () => this.restartFrom(1 - this.shooter);
      return [{ type: 'nogoal' }];
    }
    this.score[g]++;
    if (this.score[g] >= WIN_GOALS) {
      this.after = () => this.end(g, 'goals');
      return [{ type: 'goal', team: g, final: true }];
    }
    this.after = () => this.restartFrom(1 - g);
    return [{ type: 'goal', team: g, final: false }];
  }

  /** Called by the renderer once its banner has finished. */
  resume(): MatchEvent[] {
    const next = this.after;
    this.after = null;
    return next ? next() : [];
  }

  private restartFrom(team: number): MatchEvent[] {
    this.world = createWorld();
    return this.begin(team);
  }

  private end(winner: number, why: 'goals' | 'time'): MatchEvent[] {
    this.state = 'over';
    this.winner = winner;
    return [{ type: 'over', winner, why }];
  }
}

export const fmtClock = (s: number): string => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Leaderboard points for a match against the computer. */
export function matchScore(m: Match): number {
  const won = m.winner === 0;
  return (won ? 1000 : 0) + m.score[0] * 100 + (won ? Math.ceil(m.clocks[0]) : 0);
}
