import { launch, assert, sleep, toScreen } from './lib.mjs';

const t = await launch();
const { page } = t;
const box = await t.openGame('tower-defense');
await t.waitFor(() => !!window.__pfg?.scene?.getScene('defense')?.field);

const state = () =>
  page.evaluate(() => {
    const s = window.__pfg.scene.getScene('defense');
    return { gold: s.gold, lives: s.lives, wave: s.wave, score: s.score, phase: s.phase, over: s.over, won: s.won,
      towers: s.towers.size, enemies: s.enemies.length, spawns: s.spawns.length, selectedKind: s.selectedKind };
  });

let s = await state();
assert.equal(s.gold, 150);
assert.equal(s.phase, 'build');

// build an arrow tower by clicking a cell
const cell = toScreen(box, 960, 3 * 40 + 20, 3 * 40 + 20);
await page.mouse.click(cell.x, cell.y);
await sleep(100);
s = await state();
assert.equal(s.towers, 1, 'tower built');
assert.equal(s.gold, 100, 'paid for it');

// clicking the same cell selects rather than double-builds; upgrade with U
await page.mouse.click(cell.x, cell.y);
await sleep(80);
await page.keyboard.press('KeyU');
await sleep(80);
s = await state();
assert.equal(s.towers, 1);
assert.equal(s.gold, 40, 'upgrade cost 60');

// rules: start/exit refused, sealing refused
const refused = await page.evaluate(() => {
  const s = window.__pfg.scene.getScene('defense');
  s.gold = 100000;
  const a = s.tryBuild('arrow', { c: 0, r: 5 });
  const b = s.tryBuild('arrow', { c: 23, r: 6 });
  for (let r = 0; r < 12; r++) if (r !== 9) s.blocked[r][2] = true;
  const c = s.tryBuild('arrow', { c: 2, r: 9 });
  for (let r = 0; r < 12; r++) if (r !== 9) s.blocked[r][2] = false;
  return [a, b, c];
});
assert.deepEqual(refused, [false, false, false], 'start, exit and sealing placements refused');

// wave 1
await page.keyboard.press('Space');
await t.waitFor(() => window.__pfg.scene.getScene('defense').enemies.length > 0, 10000);
s = await state();
assert.equal(s.phase, 'wave');
assert.equal(s.wave, 1);
await sleep(1500);
await page.screenshot({ path: 'e2e/.last-holdfast.png' });

// kill everything as it spawns; the tower may already be doing some of it
for (let i = 0; i < 200; i++) {
  const done = await page.evaluate(() => {
    const s = window.__pfg.scene.getScene('defense');
    for (const e of [...s.enemies]) s.damage(e, 1e6);
    return s.phase === 'build';
  });
  if (done) break;
  await sleep(150);
}
s = await state();
assert.equal(s.phase, 'build', 'wave cleared');
assert.ok(s.score >= 35, `score after wave 1: ${s.score}`);

// lose: one life left, let an enemy leak
await page.evaluate(() => { window.__pfg.scene.getScene('defense').lives = 1; });
await page.keyboard.press('Space');
await t.waitFor(() => window.__pfg.scene.getScene('defense').enemies.length > 0, 10000);
await page.evaluate(() => { const s = window.__pfg.scene.getScene('defense'); s.leak(s.enemies[0]); });
await t.waitFor(() => window.__pfg.scene.getScene('defense').over);
await t.waitForResult();
console.log('  game over:', await t.status(), await t.boardRows());

await page.keyboard.press('KeyR');
await t.waitFor(() => { const s = window.__pfg.scene.getScene('defense'); return !s.over && s.wave === 0; });
await t.exitAndCheck();
await t.done();
