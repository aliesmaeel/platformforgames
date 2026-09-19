import assert from 'node:assert/strict';
import * as W from './well.ts';

// every kind has 4 cells in every rotation, within its box
for (let k = 0; k < W.KINDS; k++) {
  for (let r = 0; r < 4; r++) assert.equal(W.SHAPES[k][r].length, 4, `kind ${k} rot ${r}`);
}
// O piece is rotation-invariant as a set of cells
const setOf = (cells: [number, number][]) => cells.map((c) => c.join(',')).sort().join('|');
assert.equal(setOf(W.SHAPES[1][0]), setOf(W.SHAPES[1][1]));
// I piece alternates horizontal / vertical
assert.equal(new Set(W.SHAPES[0][0].map((c) => c[0])).size, 1, 'I horizontal');
assert.equal(new Set(W.SHAPES[0][1].map((c) => c[1])).size, 1, 'I vertical');

// spawned pieces fit in an empty well
const g = W.createGrid();
for (let k = 0; k < W.KINDS; k++) assert.ok(W.fits(g, W.spawn(k)), `spawn ${k}`);

// walls block movement; kicks let a rotation succeed against a wall
let p = W.spawn(2);
while (W.tryMove(g, p, 0, -1)) p = W.tryMove(g, p, 0, -1)!;
assert.equal(p.c, 0);
assert.equal(W.tryMove(g, p, 0, -1), null);
let vertical = W.tryRotate(g, p, 1)!;
assert.ok(vertical, 'rotate at wall');
while (W.tryMove(g, vertical, 0, -1)) vertical = W.tryMove(g, vertical, 0, -1)!;
assert.ok(W.tryRotate(g, vertical, 1), 'rotate again at wall uses a kick');

// drop distance, ghost, lock
p = W.spawn(1); // O at c=4
assert.equal(W.dropDistance(g, p), W.ROWS - 2);
const gh = W.ghost(g, p);
assert.equal(gh.r, W.ROWS - 2);
assert.equal(W.lock(g, gh), true);
assert.equal(g[W.ROWS - 1][4], 2);
assert.equal(g[W.ROWS - 1][5], 2);
assert.equal(g[W.ROWS - 2][4], 2);

// clearing: fill bottom two rows except where the O sits, then complete them
for (let c = 0; c < W.COLS; c++) {
  if (c === 4 || c === 5) continue;
  g[W.ROWS - 1][c] = 1;
  g[W.ROWS - 2][c] = 1;
}
const cleared = W.clearLines(g);
assert.deepEqual(cleared, [W.ROWS - 2, W.ROWS - 1]);
assert.ok(g.flat().every((v) => v === W.EMPTY), 'well empty after clearing both rows');
assert.equal(g.length, W.ROWS);

// lock above the well reports game over
const top = { kind: 0, rot: 0, r: -2, c: 3 };
assert.equal(W.lock(W.createGrid(), top), false);

// bag: 7 unique kinds per 7 draws
const rng = () => 0.5;
const it = W.bag(rng);
const first = Array.from({ length: 7 }, () => it.next().value);
assert.equal(new Set(first).size, 7);
const second = Array.from({ length: 7 }, () => it.next().value);
assert.equal(new Set(second).size, 7);

// scoring and pacing
assert.equal(W.lineScore(4, 2), 1600);
assert.equal(W.lineScore(0, 5), 0);
assert.equal(W.levelFor(0), 1);
assert.equal(W.levelFor(10), 2);
assert.ok(W.gravityMs(1) > W.gravityMs(5));
assert.equal(W.gravityMs(40), 70);

console.log('well.test.ts: all assertions passed');
