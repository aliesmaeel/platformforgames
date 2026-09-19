import { launch, assert, sleep, toScreen } from './lib.mjs';

const t = await launch();
const { page } = t;
const box = await t.openGame('match-three');
await t.waitFor(() => Array.isArray(window.__pfg?.scene?.getScene('match')?.grid));
assert.equal(await t.status(), 'level 1 of 8');

const state = () =>
  page.evaluate(() => {
    const s = window.__pfg.scene.getScene('match');
    return { grid: s.grid, busy: s.busy, over: s.over, moves: s.movesLeft, score: s.score, level: s.levelIndex, remaining: s.remaining };
  });
const patch = (p) => page.evaluate((p) => Object.assign(window.__pfg.scene.getScene('match'), p), p);
const waitIdle = () =>
  t.waitFor(() => {
    const s = window.__pfg.scene.getScene('match');
    return !s.busy || s.over || s.remaining.every((n) => n <= 0);
  }, 20000);

const hasMatch = (g) => {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) if (g[r][c] >= 0 && g[r][c] === g[r][c + 1] && g[r][c] === g[r][c + 2]) return true;
  for (let c = 0; c < 8; c++) for (let r = 0; r < 6; r++) if (g[r][c] >= 0 && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 2][c]) return true;
  return false;
};
const swapped = (g, a, b) => { const n = g.map((r) => r.slice()); const t = n[a.r][a.c]; n[a.r][a.c] = n[b.r][b.c]; n[b.r][b.c] = t; return n; };
const findSwap = (g, wantMatch) => {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (const b of [{ r, c: c + 1 }, { r: r + 1, c }]) {
    if (b.r > 7 || b.c > 7) continue;
    if (hasMatch(swapped(g, { r, c }, b)) === wantMatch) return [{ r, c }, b];
  }
  throw new Error('no swap found');
};
const cell = (p) => toScreen(box, 960, 40 + p.c * 56 + 28, (540 - 448) / 2 + p.r * 56 + 28);

async function play(mode, wantMatch = true) {
  const s = await state();
  const [a, b] = findSwap(s.grid, wantMatch);
  const A = cell(a), B = cell(b);
  if (mode === 'drag') {
    await page.mouse.move(A.x, A.y); await page.mouse.down();
    await page.mouse.move(B.x, B.y, { steps: 6 }); await page.mouse.up();
  } else {
    await page.mouse.click(A.x, A.y); await sleep(120); await page.mouse.click(B.x, B.y);
  }
  await sleep(300);
  await waitIdle();
  return state();
}

const s0 = await state();
let s = await play('click', false);
assert.equal(s.moves, s0.moves, 'invalid swap is free');
assert.deepEqual(s.grid, s0.grid, 'invalid swap restores the grid');

s = await play('click');
assert.equal(s.moves, s0.moves - 1);
assert.ok(s.score > 0 && !hasMatch(s.grid));
s = await play('drag');
assert.equal(s.moves, s0.moves - 2);
console.log('  after two moves: score', s.score, 'remaining', s.remaining);

await patch({ remaining: [0] });
await play('click');
await t.waitFor(() => !!window.__pfg.scene.getScene('match').overlay);
await sleep(300);
await page.mouse.click(box.x + box.w * 0.3, box.y + box.h / 2);
await t.waitFor(() => window.__pfg.scene.getScene('match').levelIndex === 1);
await sleep(500);
s = await state();
assert.equal(s.moves, 20, 'level 2 starts with its own moves');
assert.ok(s.score > 0, 'score carried over');

await patch({ movesLeft: 1 });
s = await play('click');
assert.equal(s.over, true);
await t.waitForResult();
await sleep(300);
console.log('  game over:', await t.status(), await t.boardRows());

await page.keyboard.press('KeyR');
await t.waitFor(() => { const s = window.__pfg.scene.getScene('match'); return s.levelIndex === 0 && !s.over; });

await t.exitAndCheck();
await t.done();
