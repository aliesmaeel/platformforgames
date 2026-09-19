/**
 * Pure falling-block logic: the well, the seven tetrominoes, rotation with
 * wall kicks, locking, line clears and scoring. No rendering or timing.
 */

export const COLS = 10;
export const ROWS = 20;
export const EMPTY = 0;

export type Grid = number[][]; // grid[row][col]: 0 empty, else kind + 1
export type Rng = () => number;

export interface Piece {
  kind: number;
  rot: number;
  r: number;
  c: number;
}

/** Base orientation of each kind on a small box; rotations are derived. */
const BASE: string[][] = [
  ['....', 'XXXX', '....', '....'], // I
  ['XX', 'XX'], // O
  ['.X.', 'XXX', '...'], // T
  ['.XX', 'XX.', '...'], // S
  ['XX.', '.XX', '...'], // Z
  ['X..', 'XXX', '...'], // J
  ['..X', 'XXX', '...'] // L
];

export const KINDS = BASE.length;

const rotateBox = (box: string[]): string[] => {
  const n = box.length;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => box[n - 1 - c][r]).join('')
  );
};

const toCells = (box: string[]): [number, number][] => {
  const out: [number, number][] = [];
  box.forEach((row, r) => [...row].forEach((ch, c) => ch === 'X' && out.push([r, c])));
  return out;
};

/** SHAPES[kind][rot] → list of [dr, dc] offsets from the piece origin. */
export const SHAPES: [number, number][][][] = BASE.map((box) => {
  const rots: [number, number][][] = [];
  let cur = box;
  for (let i = 0; i < 4; i++) {
    rots.push(toCells(cur));
    cur = rotateBox(cur);
  }
  return rots;
});

const KICKS: [number, number][] = [[0, 0], [0, -1], [0, 1], [0, -2], [0, 2], [-1, 0], [-1, -1], [-1, 1]];

export const createGrid = (): Grid => Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(EMPTY));

export const cells = (p: Piece): [number, number][] => SHAPES[p.kind][p.rot].map(([dr, dc]) => [p.r + dr, p.c + dc]);

export function fits(grid: Grid, p: Piece): boolean {
  for (const [r, c] of cells(p)) {
    if (c < 0 || c >= COLS || r >= ROWS) return false;
    if (r >= 0 && grid[r][c] !== EMPTY) return false;
  }
  return true;
}

export const spawn = (kind: number): Piece => ({ kind, rot: 0, r: kind === 0 ? -1 : 0, c: kind === 1 ? 4 : 3 });

export function tryMove(grid: Grid, p: Piece, dr: number, dc: number): Piece | null {
  const next = { ...p, r: p.r + dr, c: p.c + dc };
  return fits(grid, next) ? next : null;
}

export function tryRotate(grid: Grid, p: Piece, dir: 1 | -1): Piece | null {
  const rot = (p.rot + dir + 4) % 4;
  for (const [kr, kc] of KICKS) {
    const next = { ...p, rot, r: p.r + kr, c: p.c + kc };
    if (fits(grid, next)) return next;
  }
  return null;
}

export function dropDistance(grid: Grid, p: Piece): number {
  let d = 0;
  while (fits(grid, { ...p, r: p.r + d + 1 })) d++;
  return d;
}

export const ghost = (grid: Grid, p: Piece): Piece => ({ ...p, r: p.r + dropDistance(grid, p) });

/** Write the piece into the grid. Returns false if any cell is above the well (game over). */
export function lock(grid: Grid, p: Piece): boolean {
  let inside = true;
  for (const [r, c] of cells(p)) {
    if (r < 0) inside = false;
    else grid[r][c] = p.kind + 1;
  }
  return inside;
}

/** Remove full rows, returning their indices (before removal, top to bottom). */
export function clearLines(grid: Grid): number[] {
  const full: number[] = [];
  for (let r = 0; r < ROWS; r++) if (grid[r].every((v) => v !== EMPTY)) full.push(r);
  for (const r of full) {
    grid.splice(r, 1);
    grid.unshift(new Array<number>(COLS).fill(EMPTY));
  }
  return full;
}

/** 7-bag randomiser: every kind once per bag, so droughts are bounded. */
export function* bag(rng: Rng): Generator<number, never, void> {
  for (;;) {
    const kinds = Array.from({ length: KINDS }, (_, i) => i);
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    for (const k of kinds) yield k;
  }
}

export const lineScore = (lines: number, level: number): number => [0, 100, 300, 500, 800][lines] * level;

export const levelFor = (lines: number): number => 1 + Math.floor(lines / 10);

/** Milliseconds per gravity step at a level. */
export const gravityMs = (level: number): number => Math.max(70, Math.round(800 * Math.pow(0.82, level - 1)));
