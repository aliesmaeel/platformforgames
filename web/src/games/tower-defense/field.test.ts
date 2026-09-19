import assert from 'node:assert/strict';
import * as F from './field.ts';

const blocked = F.emptyBlocked(F.MAP);
assert.equal(blocked[2][6], true, 'rock present');

// field reaches start; walking downhill reaches the exit in exactly dist steps
const field = F.computeField(blocked, F.MAP.exit);
const start = F.MAP.start;
const d0 = field[start.r][start.c];
assert.ok(Number.isFinite(d0), 'start reachable');
let at = { ...start };
let steps = 0;
while (!(at.c === F.MAP.exit.c && at.r === F.MAP.exit.r)) {
  const next = F.nextCell(field, at);
  assert.ok(next, `stuck at ${at.c},${at.r}`);
  at = next;
  steps++;
  assert.ok(steps <= d0, 'never exceeds field distance');
}
assert.equal(steps, d0);
assert.equal(F.nextCell(field, F.MAP.exit), null, 'exit has no next cell');

// building is refused on rocks, start, exit, and off-grid
assert.equal(F.canBuild(blocked, F.MAP, { c: 6, r: 2 }), false);
assert.equal(F.canBuild(blocked, F.MAP, F.MAP.start), false);
assert.equal(F.canBuild(blocked, F.MAP, F.MAP.exit), false);
assert.equal(F.canBuild(blocked, F.MAP, { c: -1, r: 0 }), false);
assert.equal(F.canBuild(blocked, F.MAP, { c: 3, r: 3 }), true);

// sealing the path is refused: wall column 2 except one cell, then try to close it
for (let r = 0; r < F.MAP.rows; r++) if (r !== 9) blocked[r][2] = true;
assert.equal(F.canBuild(blocked, F.MAP, { c: 2, r: 9 }), false, 'last gap cannot be closed');
assert.equal(F.canBuild(blocked, F.MAP, { c: 3, r: 9 }), false, 'the corridor after the gap is also load-bearing');
assert.equal(F.canBuild(blocked, F.MAP, { c: 4, r: 8 }), true, 'a cell off the corridor is fine');
assert.equal(blocked[9][2], false, 'canBuild leaves the grid untouched');

// a maze makes the walk longer
const mazed = F.computeField(blocked, F.MAP.exit);
assert.ok(mazed[start.r][start.c] > d0, 'detour is longer');

// waves grow and are deterministic
const w1 = F.waveSpec(1);
const w10 = F.waveSpec(10);
assert.deepEqual(w1, F.waveSpec(1));
assert.equal(w1.length, 1);
assert.ok(w10.some((e) => e.kind === 'boss'), 'wave 10 has a boss');
assert.ok(w10.reduce((n, e) => n + e.count, 0) > w1.reduce((n, e) => n + e.count, 0));
assert.ok(F.hpScale(20) > F.hpScale(1));
assert.equal(F.upgraded(F.TOWERS.arrow, 1).damage, F.TOWERS.arrow.damage);
assert.ok(F.upgraded(F.TOWERS.arrow, 3).range > F.TOWERS.arrow.range);

console.log('field.test.ts: all assertions passed');
