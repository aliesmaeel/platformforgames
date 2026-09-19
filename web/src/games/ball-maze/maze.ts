/**
 * Rolling-ball maze rules with no rendering: level parsing and the ball's
 * motion under tilt, including wall collisions, holes and the goal.
 */

export interface Cell {
  c: number;
  r: number;
}

export interface Level {
  name: string;
  cols: number;
  rows: number;
  walls: boolean[][]; // [row][col]
  holes: Cell[];
  start: Cell;
  goal: Cell;
}

export interface Ball {
  x: number; // world units; cell (c, r) is centred at (c + 0.5, r + 0.5)
  z: number;
  vx: number;
  vz: number;
}

export const RADIUS = 0.28;
const GRAVITY = 14; // units/s² at full tilt (1 rad ≈ sin 0.84)
const DAMPING = 0.985;
const BOUNCE = 0.25;
const HOLE_R = 0.3;
const GOAL_R = 0.4;

export type Event = 'hole' | 'goal' | null;

export function parseLevel(name: string, rows: string[]): Level {
  const cols = rows[0].length;
  const walls: boolean[][] = [];
  const holes: Cell[] = [];
  let start: Cell | null = null;
  let goal: Cell | null = null;
  rows.forEach((row, r) => {
    if (row.length !== cols) throw new Error(`level ${name}: ragged row ${r}`);
    walls.push([...row].map((ch, c) => {
      if (ch === 'O') holes.push({ c, r });
      if (ch === 'S') start = { c, r };
      if (ch === 'G') goal = { c, r };
      return ch === '#';
    }));
  });
  if (!start || !goal) throw new Error(`level ${name}: needs S and G`);
  return { name, cols, rows: rows.length, walls, holes, start, goal };
}

export const centre = (cell: Cell): { x: number; z: number } => ({ x: cell.c + 0.5, z: cell.r + 0.5 });

export function spawnBall(level: Level): Ball {
  const { x, z } = centre(level.start);
  return { x, z, vx: 0, vz: 0 };
}

const isWall = (level: Level, c: number, r: number): boolean =>
  c < 0 || r < 0 || c >= level.cols || r >= level.rows || level.walls[r][c];

/** Advance the ball by dt seconds under a tilt (radians; +x rolls toward +x). Mutates `ball`. */
export function stepBall(level: Level, ball: Ball, tiltX: number, tiltZ: number, dt: number): Event {
  ball.vx += Math.sin(tiltX) * GRAVITY * dt;
  ball.vz += Math.sin(tiltZ) * GRAVITY * dt;
  const damp = Math.pow(DAMPING, dt * 60);
  ball.vx *= damp;
  ball.vz *= damp;

  // Move one axis at a time so corners resolve cleanly.
  ball.x += ball.vx * dt;
  resolve(level, ball, 'x');
  ball.z += ball.vz * dt;
  resolve(level, ball, 'z');

  for (const h of level.holes) {
    const { x, z } = centre(h);
    if (Math.hypot(ball.x - x, ball.z - z) < HOLE_R) return 'hole';
  }
  const g = centre(level.goal);
  if (Math.hypot(ball.x - g.x, ball.z - g.z) < GOAL_R) return 'goal';
  return null;
}

function resolve(level: Level, ball: Ball, axis: 'x' | 'z'): void {
  const minC = Math.floor(ball.x - RADIUS);
  const maxC = Math.floor(ball.x + RADIUS);
  const minR = Math.floor(ball.z - RADIUS);
  const maxR = Math.floor(ball.z + RADIUS);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (!isWall(level, c, r)) continue;
      // Closest point on the wall cell to the ball centre.
      const px = Math.max(c, Math.min(ball.x, c + 1));
      const pz = Math.max(r, Math.min(ball.z, r + 1));
      const dx = ball.x - px;
      const dz = ball.z - pz;
      const dist = Math.hypot(dx, dz);
      // Touching (dist == RADIUS) is fine; only real penetration is pushed out.
      if (dist >= RADIUS - 1e-6) continue;
      if (axis === 'x') {
        ball.x = ball.x < c + 0.5 ? c - RADIUS : c + 1 + RADIUS;
        ball.vx = -ball.vx * BOUNCE;
      } else {
        ball.z = ball.z < r + 0.5 ? r - RADIUS : r + 1 + RADIUS;
        ball.vz = -ball.vz * BOUNCE;
      }
    }
  }
}

/** Points for finishing a level: faster is better, falls cost time. */
export const levelScore = (seconds: number): number => Math.max(150, 1500 - Math.floor(seconds) * 25);
export const FALL_PENALTY_S = 5;
