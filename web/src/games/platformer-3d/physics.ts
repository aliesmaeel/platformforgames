/**
 * Platformer rules with no rendering: AABB player vs. platforms (some of
 * which move), jump feel (coyote time, jump buffer), coins and the goal.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Motion {
  axis: 'x' | 'y' | 'z';
  amp: number;
  period: number; // seconds per full cycle
  phase?: number;
}

export interface Platform {
  id: number;
  x: number; // centre
  y: number;
  z: number;
  w: number; // full sizes
  h: number;
  d: number;
  kind?: 'normal' | 'goal' | 'checkpoint';
  move?: Motion;
  colour?: number;
}

export interface Coin extends Vec3 {
  taken: boolean;
}

export interface LevelDef {
  name: string;
  spawn: Vec3;
  platforms: Platform[];
  coins: Coin[];
  killY: number;
}

export interface Player extends Vec3 {
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundId: number | null;
  coyote: number;
  buffer: number;
  facing: number; // radians, for the mesh
}

export interface Input {
  /** World-space move direction, length ≤ 1. */
  mx: number;
  mz: number;
  jump: boolean; // held
  jumpPressed: boolean; // edge
}

export interface StepResult {
  fell: boolean;
  coins: number[];
  goal: boolean;
  checkpoint: Platform | null;
}

export const SIZE = { w: 0.8, h: 1.5, d: 0.8 };
const SPEED = 7.5;
const ACCEL = 40;
const AIR = 0.55;
const GRAVITY = 30;
const JUMP = 11.5;
const COYOTE = 0.12;
const BUFFER = 0.12;
const COIN_R = 1.0;

export function spawnPlayer(at: Vec3): Player {
  return { ...at, vx: 0, vy: 0, vz: 0, grounded: false, groundId: null, coyote: 0, buffer: 0, facing: 0 };
}

/** Where a platform is at time t. */
export function platformAt(p: Platform, t: number): Vec3 {
  if (!p.move) return { x: p.x, y: p.y, z: p.z };
  const off = Math.sin(((t / p.move.period) * 2 + (p.move.phase ?? 0)) * Math.PI) * p.move.amp;
  return { x: p.x + (p.move.axis === 'x' ? off : 0), y: p.y + (p.move.axis === 'y' ? off : 0), z: p.z + (p.move.axis === 'z' ? off : 0) };
}

const overlaps = (pl: Player, c: Vec3, p: Platform): boolean =>
  Math.abs(pl.x - c.x) < (SIZE.w + p.w) / 2 &&
  pl.y < c.y + p.h / 2 && pl.y + SIZE.h > c.y - p.h / 2 &&
  Math.abs(pl.z - c.z) < (SIZE.d + p.d) / 2;

/** Advance the player. `t` is level time in seconds (drives moving platforms). Mutates `pl`. */
export function step(pl: Player, input: Input, level: LevelDef, t: number, dt: number): StepResult {
  const result: StepResult = { fell: false, coins: [], goal: false, checkpoint: null };
  const positions = level.platforms.map((p) => platformAt(p, t));

  // Ride whatever we stood on last frame.
  if (pl.grounded && pl.groundId !== null) {
    const p = level.platforms.find((q) => q.id === pl.groundId);
    if (p?.move) {
      const before = platformAt(p, t - dt);
      const now = positions[level.platforms.indexOf(p)];
      pl.x += now.x - before.x;
      pl.y += now.y - before.y;
      pl.z += now.z - before.z;
    }
  }

  // Horizontal velocity eases toward the input direction.
  const control = pl.grounded ? 1 : AIR;
  const tx = input.mx * SPEED;
  const tz = input.mz * SPEED;
  pl.vx += Math.max(-ACCEL * control * dt, Math.min(ACCEL * control * dt, tx - pl.vx));
  pl.vz += Math.max(-ACCEL * control * dt, Math.min(ACCEL * control * dt, tz - pl.vz));
  if (Math.hypot(input.mx, input.mz) > 0.1) pl.facing = Math.atan2(input.mx, input.mz);

  // Jump: buffer presses, allow shortly after leaving a ledge.
  pl.buffer = input.jumpPressed ? BUFFER : Math.max(0, pl.buffer - dt);
  pl.coyote = pl.grounded ? COYOTE : Math.max(0, pl.coyote - dt);
  if (pl.buffer > 0 && pl.coyote > 0) {
    pl.vy = JUMP;
    pl.grounded = false;
    pl.groundId = null;
    pl.coyote = 0;
    pl.buffer = 0;
  }
  // Variable height: releasing early cuts the jump.
  if (!input.jump && pl.vy > 4) pl.vy = 4;

  pl.vy -= GRAVITY * dt;

  // Move axis by axis and push out of platforms.
  pl.x += pl.vx * dt;
  level.platforms.forEach((p, i) => {
    const c = positions[i];
    if (!overlaps(pl, c, p)) return;
    pl.x = pl.x < c.x ? c.x - (p.w + SIZE.w) / 2 : c.x + (p.w + SIZE.w) / 2;
    pl.vx = 0;
  });
  pl.z += pl.vz * dt;
  level.platforms.forEach((p, i) => {
    const c = positions[i];
    if (!overlaps(pl, c, p)) return;
    pl.z = pl.z < c.z ? c.z - (p.d + SIZE.d) / 2 : c.z + (p.d + SIZE.d) / 2;
    pl.vz = 0;
  });

  pl.y += pl.vy * dt;
  let landed: Platform | null = null;
  level.platforms.forEach((p, i) => {
    const c = positions[i];
    if (!overlaps(pl, c, p)) return;
    if (pl.vy <= 0 && pl.y + SIZE.h / 2 > c.y) {
      pl.y = c.y + p.h / 2;
      pl.vy = 0;
      landed = p;
    } else {
      pl.y = c.y - p.h / 2 - SIZE.h;
      pl.vy = Math.min(pl.vy, 0);
    }
  });
  pl.grounded = landed !== null;
  pl.groundId = landed ? (landed as Platform).id : null;
  if (landed) {
    const kind = (landed as Platform).kind;
    if (kind === 'goal') result.goal = true;
    if (kind === 'checkpoint') result.checkpoint = landed;
  }

  level.coins.forEach((coin, i) => {
    if (coin.taken) return;
    if (Math.hypot(coin.x - pl.x, coin.y - (pl.y + SIZE.h / 2), coin.z - pl.z) < COIN_R) {
      coin.taken = true;
      result.coins.push(i);
    }
  });

  if (pl.y < level.killY) result.fell = true;
  return result;
}

export const COIN_VALUE = 100;
export const FALL_PENALTY = 50;
export const timeBonus = (seconds: number): number => Math.max(0, 1200 - Math.floor(seconds) * 20);
