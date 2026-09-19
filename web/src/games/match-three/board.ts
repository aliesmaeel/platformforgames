/**
 * Pure match-3 board logic. No rendering, no Phaser — so it can be tested in
 * Node and reused by any front end.
 */

export type Grid = number[][]; // grid[row][col] = colour index, EMPTY when vacant
export const EMPTY = -1;

export type Pos = { r: number; c: number };
export type Rng = () => number;

export interface MatchGroup {
  colour: number;
  cells: Pos[];
}

export interface Drop {
  from: Pos;
  to: Pos;
}

export interface Spawn {
  pos: Pos;
  colour: number;
  /** How many rows above the top edge it starts — for the drop-in animation. */
  fromAbove: number;
}

/** Deterministic PRNG so a level plays the same for everyone. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randColour = (colours: number, rng: Rng) => Math.floor(rng() * colours);

/** A board with no ready-made matches and at least one legal move. */
export function createBoard(rows: number, cols: number, colours: number, rng: Rng): Grid {
  for (let attempt = 0; attempt < 100; attempt++) {
    const grid: Grid = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        let colour = randColour(colours, rng);
        // Avoid completing a line of three while filling.
        while (
          (c >= 2 && row[c - 1] === colour && row[c - 2] === colour) ||
          (r >= 2 && grid[r - 1][c] === colour && grid[r - 2][c] === colour)
        ) {
          colour = (colour + 1) % colours;
        }
        row.push(colour);
      }
      grid.push(row);
    }
    if (findMove(grid)) return grid;
  }
  throw new Error('could not build a board with a legal move');
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

export function swap(grid: Grid, a: Pos, b: Pos): void {
  const tmp = grid[a.r][a.c];
  grid[a.r][a.c] = grid[b.r][b.c];
  grid[b.r][b.c] = tmp;
}

export const adjacent = (a: Pos, b: Pos): boolean =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

/** Every run of 3+ in a row or column, as groups. A cell can be in two groups (L/T shapes). */
export function findMatches(grid: Grid): MatchGroup[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const groups: MatchGroup[] = [];

  const scan = (
    outer: number,
    inner: number,
    at: (i: number, j: number) => Pos
  ) => {
    for (let i = 0; i < outer; i++) {
      let start = 0;
      for (let j = 1; j <= inner; j++) {
        const cur = j < inner ? grid[at(i, j).r][at(i, j).c] : Number.NaN;
        const prev = grid[at(i, start).r][at(i, start).c];
        if (cur !== prev) {
          if (j - start >= 3 && prev !== EMPTY) {
            const cells: Pos[] = [];
            for (let k = start; k < j; k++) cells.push(at(i, k));
            groups.push({ colour: prev, cells });
          }
          start = j;
        }
      }
    }
  };

  scan(rows, cols, (r, c) => ({ r, c }));
  scan(cols, rows, (c, r) => ({ r, c }));
  return groups;
}

/** Unique positions across groups. */
export function matchedCells(groups: MatchGroup[]): Pos[] {
  const seen = new Set<string>();
  const out: Pos[] = [];
  for (const g of groups) {
    for (const p of g.cells) {
      const key = `${p.r},${p.c}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
  }
  return out;
}

export function clearCells(grid: Grid, cells: Pos[]): void {
  for (const p of cells) grid[p.r][p.c] = EMPTY;
}

/** Let gems fall into empty cells below them. Returns what moved where. */
export function collapse(grid: Grid): Drop[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const drops: Drop[] = [];
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (grid[r][c] === EMPTY) continue;
      if (write !== r) {
        grid[write][c] = grid[r][c];
        grid[r][c] = EMPTY;
        drops.push({ from: { r, c }, to: { r: write, c } });
      }
      write--;
    }
  }
  return drops;
}

/** Fill remaining empties from the top with fresh colours. */
export function refill(grid: Grid, colours: number, rng: Rng): Spawn[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const spawns: Spawn[] = [];
  for (let c = 0; c < cols; c++) {
    let above = 0;
    for (let r = rows - 1; r >= 0; r--) {
      if (grid[r][c] !== EMPTY) continue;
      above++;
      const colour = randColour(colours, rng);
      grid[r][c] = colour;
      spawns.push({ pos: { r, c }, colour, fromAbove: above });
    }
  }
  // Re-index fromAbove so the lowest spawn in a column falls the shortest distance.
  for (let c = 0; c < cols; c++) {
    const col = spawns.filter((s) => s.pos.c === c).sort((a, b) => a.pos.r - b.pos.r);
    col.forEach((s, i) => (s.fromAbove = col.length - i));
  }
  return spawns;
}

/** First swap that would create a match, or null if the board is stuck. */
export function findMove(grid: Grid): [Pos, Pos] | null {
  const rows = grid.length;
  const cols = grid[0].length;
  const test = (a: Pos, b: Pos): boolean => {
    swap(grid, a, b);
    const ok = findMatches(grid).length > 0;
    swap(grid, a, b);
    return ok;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && test({ r, c }, { r, c: c + 1 })) return [{ r, c }, { r, c: c + 1 }];
      if (r + 1 < rows && test({ r, c }, { r: r + 1, c })) return [{ r, c }, { r: r + 1, c }];
    }
  }
  return null;
}

/** Reshuffle in place until there is a move and no free match. */
export function shuffle(grid: Grid, rng: Rng): void {
  const flat = grid.flat();
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    const cols = grid[0].length;
    for (let i = 0; i < flat.length; i++) grid[Math.floor(i / cols)][i % cols] = flat[i];
    if (findMatches(grid).length === 0 && findMove(grid)) return;
  }
}

/** Points for one resolution step: bigger groups and deeper cascades pay more. */
export function scoreGroups(groups: MatchGroup[], cascade: number): number {
  let total = 0;
  for (const g of groups) {
    const n = g.cells.length;
    total += n >= 5 ? 200 : n === 4 ? 120 : 60;
  }
  return total * cascade;
}
