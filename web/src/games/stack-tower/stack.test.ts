import assert from 'node:assert/strict';
import * as S from './stack.ts';

const base: S.Slab = { x: 0, z: 0, w: 3, d: 3 };

// perfect drop snaps to the block below
const p = S.drop(base, { x: 0.05, z: 0, w: 3, d: 3 }, 'x');
assert.ok(p && p.perfect);
assert.deepEqual(p.placed, base);
assert.equal(p.cut, null);

// offset drop trims the overhang and the cut piece sits beyond the edge
const r = S.drop(base, { x: 1, z: 0, w: 3, d: 3 }, 'x');
assert.ok(r && !r.perfect);
assert.ok(Math.abs(r.placed.w - 2) < 1e-9, 'kept 2 of 3');
assert.ok(Math.abs(r.placed.x - 0.5) < 1e-9, 'centred on the overlap');
assert.ok(r.cut && Math.abs(r.cut.w - 1) < 1e-9, 'cut is the missing 1');
assert.ok(r.cut && Math.abs(r.cut.x - 2) < 1e-9, `cut sits at the edge (${r.cut?.x})`);
// placed + cut exactly tile the moving block
assert.ok(r.cut && Math.abs(r.placed.x - r.placed.w / 2 - (1 - 1.5)) < 1e-9);
assert.ok(r.cut && Math.abs(r.cut.x + r.cut.w / 2 - (1 + 1.5)) < 1e-9);

// same along z, negative direction
const rz = S.drop(base, { x: 0, z: -0.75, w: 3, d: 3 }, 'z');
assert.ok(rz && Math.abs(rz.placed.d - 2.25) < 1e-9 && Math.abs(rz.placed.z + 0.375) < 1e-9);
assert.ok(rz?.cut && rz.cut.z < rz.placed.z, 'cut on the negative side');

// missing entirely
assert.equal(S.drop(base, { x: 3, z: 0, w: 3, d: 3 }, 'x'), null);
assert.equal(S.drop(base, { x: -3.1, z: 0, w: 3, d: 3 }, 'x'), null);

// growth is capped
let g: S.Slab = { x: 0, z: 0, w: 3.5, d: 3 };
g = S.grown(g, 'x');
assert.equal(g.w, S.MAX_SIZE);
assert.ok(S.speedFor(50) <= 7.5 && S.speedFor(1) > S.speedFor(0));

console.log('stack.test.ts: all assertions passed');
