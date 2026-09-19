/**
 * Tower-defense rules with no rendering: the grid, a BFS flow field from the
 * exit (enemies walk downhill), build validation, tower/enemy stats, waves.
 */

export interface Cell {
  c: number;
  r: number;
}

export interface MapSpec {
  cols: number;
  rows: number;
  start: Cell;
  exit: Cell;
  rocks: Cell[];
}

export const MAP: MapSpec = {
  cols: 24,
  rows: 12,
  start: { c: 0, r: 5 },
  exit: { c: 23, r: 6 },
  rocks: [
    { c: 6, r: 2 }, { c: 6, r: 3 }, { c: 6, r: 8 }, { c: 6, r: 9 },
    { c: 12, r: 0 }, { c: 12, r: 1 }, { c: 12, r: 10 }, { c: 12, r: 11 },
    { c: 17, r: 3 }, { c: 17, r: 4 }, { c: 17, r: 7 }, { c: 17, r: 8 }
  ]
};

export type Blocked = boolean[][]; // [row][col]

export function emptyBlocked(map: MapSpec): Blocked {
  const b: Blocked = Array.from({ length: map.rows }, () => new Array<boolean>(map.cols).fill(false));
  for (const rock of map.rocks) b[rock.r][rock.c] = true;
  return b;
}

const DIRS: Cell[] = [{ c: 1, r: 0 }, { c: -1, r: 0 }, { c: 0, r: 1 }, { c: 0, r: -1 }];

/** Distance-to-exit for every walkable cell (Infinity where unreachable). */
export function computeField(blocked: Blocked, exit: Cell): number[][] {
  const rows = blocked.length;
  const cols = blocked[0].length;
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(Infinity));
  const queue: Cell[] = [exit];
  dist[exit.r][exit.c] = 0;
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const d of DIRS) {
      const c = cur.c + d.c;
      const r = cur.r + d.r;
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      if (blocked[r][c] || dist[r][c] !== Infinity) continue;
      dist[r][c] = dist[cur.r][cur.c] + 1;
      queue.push({ c, r });
    }
  }
  return dist;
}

/** The neighbour to step to next, or null at the exit / when trapped. */
export function nextCell(field: number[][], at: Cell): Cell | null {
  let best: Cell | null = null;
  let bestDist = field[at.r][at.c];
  for (const d of DIRS) {
    const c = at.c + d.c;
    const r = at.r + d.r;
    if (r < 0 || r >= field.length || c < 0 || c >= field[0].length) continue;
    if (field[r][c] < bestDist) {
      bestDist = field[r][c];
      best = { c, r };
    }
  }
  return best;
}

/** Can a tower go here without sealing the path from start to exit? */
export function canBuild(blocked: Blocked, map: MapSpec, at: Cell): boolean {
  if (at.c < 0 || at.c >= map.cols || at.r < 0 || at.r >= map.rows) return false;
  if (blocked[at.r][at.c]) return false;
  if ((at.c === map.start.c && at.r === map.start.r) || (at.c === map.exit.c && at.r === map.exit.r)) return false;
  blocked[at.r][at.c] = true;
  const reachable = computeField(blocked, map.exit)[map.start.r][map.start.c] !== Infinity;
  blocked[at.r][at.c] = false;
  return reachable;
}

// ---------- towers ----------

export type TowerKind = 'arrow' | 'cannon' | 'frost';

export interface TowerSpec {
  kind: TowerKind;
  name: string;
  cost: number;
  range: number; // px
  damage: number;
  cooldown: number; // ms
  splash?: number; // px radius
  slow?: number; // fraction of speed removed, for `slowMs`
  slowMs?: number;
  colour: number;
}

export const TOWERS: Record<TowerKind, TowerSpec> = {
  arrow: { kind: 'arrow', name: 'Arrow', cost: 50, range: 110, damage: 6, cooldown: 420, colour: 0x4cc9f0 },
  cannon: { kind: 'cannon', name: 'Cannon', cost: 120, range: 130, damage: 18, cooldown: 1300, splash: 55, colour: 0xff9f1c },
  frost: { kind: 'frost', name: 'Frost', cost: 80, range: 100, damage: 2, cooldown: 700, slow: 0.45, slowMs: 1200, colour: 0xa78bfa }
};

export const UPGRADE_COST = (level: number): number => 60 * level;
/** Upgrades multiply damage and add range. */
export const upgraded = (spec: TowerSpec, level: number): { damage: number; range: number } => ({
  damage: Math.round(spec.damage * (1 + 0.5 * (level - 1))),
  range: spec.range + 12 * (level - 1)
});
export const SELL_RATIO = 0.6;

// ---------- enemies ----------

export type EnemyKind = 'grunt' | 'swift' | 'brute' | 'boss';

export interface EnemySpec {
  kind: EnemyKind;
  hp: number;
  speed: number; // px/s
  value: number; // gold and score on kill
  leak: number; // lives lost if it reaches the exit
  radius: number;
  colour: number;
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  grunt: { kind: 'grunt', hp: 30, speed: 62, value: 6, leak: 1, radius: 9, colour: 0x8ac926 },
  swift: { kind: 'swift', hp: 16, speed: 125, value: 8, leak: 1, radius: 7, colour: 0xf72585 },
  brute: { kind: 'brute', hp: 140, speed: 42, value: 20, leak: 2, radius: 13, colour: 0xffd166 },
  boss: { kind: 'boss', hp: 900, speed: 36, value: 120, leak: 6, radius: 18, colour: 0xfb7185 }
};

export const FINAL_WAVE = 20;

export interface WaveEntry {
  kind: EnemyKind;
  count: number;
  gapMs: number;
}

/** Composition for wave n (1-based). Deterministic so players can plan. */
export function waveSpec(n: number): WaveEntry[] {
  const entries: WaveEntry[] = [{ kind: 'grunt', count: 5 + n, gapMs: Math.max(320, 750 - n * 20) }];
  if (n >= 3) entries.push({ kind: 'swift', count: Math.floor(n * 1.2), gapMs: 380 });
  if (n >= 5) entries.push({ kind: 'brute', count: Math.floor((n - 3) / 2), gapMs: 900 });
  if (n % 10 === 0) entries.push({ kind: 'boss', count: n / 10, gapMs: 1500 });
  return entries;
}

/** HP multiplier per wave. */
export const hpScale = (n: number): number => 1 + 0.13 * (n - 1);

export const waveBonus = (n: number): number => 30 + n * 5;
