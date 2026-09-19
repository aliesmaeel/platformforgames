/**
 * Level definitions are plain data: add a level here and it ships with no
 * code changes. Colour indices follow GEMS in MatchScene (0 red, 1 orange,
 * 2 yellow, 3 green, 4 cyan, 5 purple). A level with `colours: 5` never
 * spawns purple, so keep its goals within 0–4.
 */

export interface Goal {
  colour: number;
  count: number;
}

export interface Level {
  name: string;
  moves: number;
  colours: 5 | 6;
  goals: Goal[];
  seed: number;
}

export const LEVELS: Level[] = [
  { name: 'Warm up',      moves: 20, colours: 5, goals: [{ colour: 0, count: 15 }], seed: 101 },
  { name: 'Two of a kind', moves: 20, colours: 5, goals: [{ colour: 4, count: 15 }, { colour: 3, count: 15 }], seed: 102 },
  { name: 'Gold rush',    moves: 22, colours: 5, goals: [{ colour: 2, count: 28 }], seed: 103 },
  { name: 'Purple reign', moves: 24, colours: 6, goals: [{ colour: 0, count: 18 }, { colour: 5, count: 18 }], seed: 104 },
  { name: 'Cold front',   moves: 24, colours: 6, goals: [{ colour: 4, count: 24 }, { colour: 1, count: 24 }], seed: 105 },
  { name: 'Overgrown',    moves: 26, colours: 6, goals: [{ colour: 3, count: 36 }], seed: 106 },
  { name: 'Triple threat', moves: 26, colours: 6, goals: [{ colour: 0, count: 22 }, { colour: 2, count: 22 }, { colour: 5, count: 22 }], seed: 107 },
  { name: 'The long haul', moves: 30, colours: 6, goals: [{ colour: 4, count: 45 }, { colour: 1, count: 30 }], seed: 108 }
];
