import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;
await t.openGame('block-drop');
await t.waitFor(() => !!window.__pfg?.scene?.getScene('stack')?.piece);
assert.equal(await t.status(), 'level 1');

const state = () =>
  page.evaluate(() => {
    const s = window.__pfg.scene.getScene('stack');
    return { piece: s.piece, score: s.score, lines: s.lines, level: s.level, over: s.over, hold: s.hold, queue: s.queue, filled: s.grid.flat().filter((v) => v).length };
  });

// movement, rotation, hold
let s0 = await state();
await page.keyboard.press('ArrowLeft');
await sleep(60);
let s = await state();
assert.equal(s.piece.c, s0.piece.c - 1, 'moved left');
await page.keyboard.press('ArrowUp');
await sleep(60);
s = await state();
assert.equal(s.piece.rot, (s0.piece.rot + 1) % 4, 'rotated');
await page.keyboard.press('KeyC');
await sleep(60);
s = await state();
assert.equal(s.hold, s0.piece.kind, 'held current piece');
assert.equal(s.queue.length, 3, 'preview stays three deep');

// hard drop locks and scores for the distance
s0 = await state();
await page.keyboard.press('Space');
await sleep(120);
s = await state();
assert.equal(s.filled, 4, 'one piece locked');
assert.ok(s.score > 0, 'hard-drop points');

// clear lines: fill the bottom row directly, then drop a vertical I piece into the gap
await page.evaluate(() => {
  const sc = window.__pfg.scene.getScene('stack');
  const W = sc.grid;
  for (let r = 0; r < W.length; r++) W[r].fill(0);
  for (let c = 1; c < 10; c++) W[19][c] = 1;
  sc.piece = { kind: 0, rot: 1, r: 0, c: -2 }; // vertical I whose column lands in c=0
});
// vertical I rot 1 occupies column offset 2 → grid column 0
await page.keyboard.press('Space');
await sleep(400);
s = await state();
assert.equal(s.lines, 1, 'line cleared');
assert.ok(s.score >= 100, 'line scored');
await page.screenshot({ path: 'e2e/.last-stackfall.png' });

// top out: fill the well and let the next piece fail to spawn
await page.evaluate(() => {
  const sc = window.__pfg.scene.getScene('stack');
  for (let r = 1; r < 20; r++) for (let c = 1; c < 10; c++) sc.grid[r][c] = 1;
});
await page.keyboard.press('Space');
await t.waitFor(() => window.__pfg.scene.getScene('stack').over, 10000);
await t.waitForResult();
console.log('  game over:', await t.status(), await t.boardRows());

await page.keyboard.press('KeyR');
await t.waitFor(() => !window.__pfg.scene.getScene('stack').over);
await t.exitAndCheck();
await t.done();
