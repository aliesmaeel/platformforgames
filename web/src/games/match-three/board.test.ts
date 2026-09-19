import assert from 'node:assert/strict';
import * as B from './board.ts';

const rng = B.mulberry32(42);

// createBoard: no matches, a move exists, correct shape
for (let i = 0; i < 50; i++) {
  const g = B.createBoard(8, 8, 5, rng);
  assert.equal(g.length, 8);
  assert.equal(g[0].length, 8);
  assert.equal(B.findMatches(g).length, 0, 'fresh board has no matches');
  assert.ok(B.findMove(g), 'fresh board has a move');
}

// findMatches: row, column, and L shape
const g1: B.Grid = [
  [0, 0, 0, 1],
  [2, 3, 4, 1],
  [5, 6, 7, 1],
  [8, 9, 3, 2]
];
const m1 = B.findMatches(g1);
assert.equal(m1.length, 2);
assert.deepEqual(m1.map((m) => m.cells.length), [3, 3]);
assert.equal(B.matchedCells(m1).length, 6);

const gL: B.Grid = [
  [0, 0, 0, 1],
  [0, 3, 4, 1],
  [0, 6, 7, 2],
  [8, 9, 3, 2]
];
const mL = B.findMatches(gL);
assert.equal(mL.length, 2);
assert.equal(B.matchedCells(mL).length, 5, 'L shape shares its corner');

// five in a row is one group
const g5: B.Grid = [[1, 1, 1, 1, 1], [2, 3, 4, 5, 6]];
assert.equal(B.findMatches(g5).length, 1);
assert.equal(B.findMatches(g5)[0].cells.length, 5);
assert.equal(B.scoreGroups(B.findMatches(g5), 1), 200);
assert.equal(B.scoreGroups(B.findMatches(g5), 3), 600);

// collapse + refill
const g2: B.Grid = [
  [1, 2],
  [B.EMPTY, 3],
  [4, B.EMPTY]
];
const drops = B.collapse(g2);
assert.deepEqual(g2, [[B.EMPTY, B.EMPTY], [1, 2], [4, 3]]);
assert.equal(drops.length, 3); // 1 falls one row, 2 and 3 each fall one row
const spawns = B.refill(g2, 3, rng);
assert.equal(spawns.length, 2);
assert.ok(g2.flat().every((v) => v !== B.EMPTY));
assert.ok(spawns.every((s) => s.fromAbove === 1));

// column spawn ordering: top of column falls furthest
const g3: B.Grid = [[B.EMPTY], [B.EMPTY], [B.EMPTY], [7]];
const s3 = B.refill(g3, 3, rng).sort((a, b) => a.pos.r - b.pos.r);
assert.deepEqual(s3.map((s) => s.fromAbove), [3, 2, 1]);

// findMove on a stuck board returns null; shuffle fixes it
const stuck: B.Grid = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2]
];
assert.equal(B.findMove(stuck), null);
const mixed: B.Grid = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2]
];
B.shuffle(mixed, B.mulberry32(7));
assert.equal(B.findMatches(mixed).length, 0);
assert.ok(B.findMove(mixed));

// swap + adjacent
const g4: B.Grid = [[1, 2]];
B.swap(g4, { r: 0, c: 0 }, { r: 0, c: 1 });
assert.deepEqual(g4, [[2, 1]]);
assert.ok(B.adjacent({ r: 0, c: 0 }, { r: 0, c: 1 }));
assert.ok(!B.adjacent({ r: 0, c: 0 }, { r: 1, c: 1 }));

// determinism
const a = B.createBoard(8, 8, 6, B.mulberry32(99));
const b = B.createBoard(8, 8, 6, B.mulberry32(99));
assert.deepEqual(a, b);

console.log('board.test.ts: all assertions passed');
