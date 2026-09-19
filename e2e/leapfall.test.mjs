import { launch, assert } from './lib.mjs';

const t = await launch();
const { page } = t;
await t.openGame('platformer-3d');
await t.waitFor(() => !!window.__pfg?.player);
assert.equal(await t.status(), 'level 1 of 3');

const state = () => page.evaluate(() => { const g = window.__pfg; return { level: g.levelIndex, p: { ...g.player }, score: g.score, coins: g.coins, over: g.over }; });

// settle on the start platform, then walk right and jump
await t.waitFor(() => window.__pfg.player.grounded, 8000);
const s0 = await state();
await page.keyboard.down('KeyD');
await t.waitFor((x) => window.__pfg.player.x > x + 0.8, 8000, s0.p.x);
await page.keyboard.up('KeyD');
await page.keyboard.down('Space');
await t.waitFor(() => !window.__pfg.player.grounded && window.__pfg.player.y > 1.3, 8000);
await page.keyboard.up('Space');
console.log('  walked and jumped');

// fall out of the world: penalty (clamped at 0) and respawn at the checkpoint
await page.evaluate(() => window.__pfg.setPlayer(0, -20, 0));
await t.waitFor(() => Math.abs(window.__pfg.player.y - 1) < 3 && window.__pfg.player.y > -5, 8000);
let s = await state();
assert.equal(s.score, 0, 'penalty cannot go below zero');

// collect a coin by standing where it is
await page.evaluate(() => { const c = window.__pfg.level.coins[0]; window.__pfg.setPlayer(c.x, c.y + 0.5, c.z); });
await t.waitFor(() => window.__pfg.coins === 1, 8000);
s = await state();
assert.equal(s.score, 100);

// drop onto each goal in turn
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const g = window.__pfg;
    const goal = g.level.platforms.find((p) => p.kind === 'goal');
    g.setPlayer(goal.x, goal.y + 2, goal.z);
  });
  await t.waitFor((i) => window.__pfg.levelIndex === i + 1 || window.__pfg.over, 8000, i);
}
s = await state();
assert.equal(s.over, true);
assert.ok(s.score > 100, `time bonuses added (${s.score})`);
await t.waitForResult();
console.log('  finished:', await t.status(), await t.boardRows());
await page.screenshot({ path: 'e2e/.last-leapfall.png' });

await page.keyboard.press('KeyR');
await t.waitFor(() => !window.__pfg.over && window.__pfg.levelIndex === 0);
await t.exitAndCheck();
await t.done();
