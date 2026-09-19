import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;
await t.openGame('ball-maze');
await t.waitFor(() => !!window.__pfg?.ball);
assert.equal(await t.status(), 'level 1 of 5');

const state = () => page.evaluate(() => { const g = window.__pfg; return { level: g.levelIndex, ball: { ...g.ball }, elapsed: g.elapsed, score: g.score, over: g.over, tilt: { ...g.tilt } }; });

// tilt right with the keyboard: ball rolls +x
const s0 = await state();
await page.keyboard.down('ArrowRight');
await t.waitFor((x0) => window.__pfg.ball.x > x0 + 0.5 && window.__pfg.tilt.x > 0.2, 8000, s0.ball.x);
await page.keyboard.up('ArrowRight');
let s = await state();
console.log('  rolled right', s0.ball.x, '→', s.ball.x.toFixed(2), 'tilt', s.tilt.x.toFixed(2));

// drag with the pointer tilts too
const box = await page.$eval('.stage', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.w / 2, box.y + box.h * 0.9, { steps: 4 });
await t.waitFor(() => window.__pfg.tilt.z > 0.2, 8000);
await page.mouse.up();
await sleep(300);

// fall into the hole: time penalty and respawn at start
const before = await state();
await page.evaluate(() => window.__pfg.setBall(5.5, 3.5));
await t.waitFor((e0) => window.__pfg.elapsed >= e0 + 5, 8000, before.elapsed);
s = await state();
assert.ok(s.elapsed >= before.elapsed + 5, `penalty applied (${before.elapsed} → ${s.elapsed})`);
assert.ok(Math.abs(s.ball.x - 1.5) < 0.5 && Math.abs(s.ball.z - 1.5) < 0.5, 'respawned at start');

// reach the goal on each level until the run ends
for (let i = 0; i < 5; i++) {
  const goal = await page.evaluate(() => { const l = window.__pfg.level; return { x: l.goal.c + 0.5, z: l.goal.r + 0.5 }; });
  await page.evaluate((g) => window.__pfg.setBall(g.x, g.z), goal);
  await t.waitFor((i) => window.__pfg.levelIndex === i + 1 || window.__pfg.over, 8000, i);
  s = await state();
  if (i < 4) assert.equal(s.level, i + 1, `advanced to level ${i + 2}`);
}
assert.equal(s.over, true, 'finished all levels');
assert.ok(s.score >= 5 * 150, `score ${s.score}`);
await t.waitForResult();
console.log('  finished:', await t.status(), await t.boardRows());
await page.screenshot({ path: 'e2e/.last-tiltway.png' });

await page.keyboard.press('KeyR');
await t.waitFor(() => !window.__pfg.over && window.__pfg.levelIndex === 0);
await t.exitAndCheck();
await t.done();
