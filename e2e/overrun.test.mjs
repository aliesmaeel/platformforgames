import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;
const box = await t.openGame('arena-shooter');
await t.waitFor(() => !!window.__pfg?.scene?.getScene('arena')?.player);
assert.equal(await t.status(), 'wave 1');

const state = () =>
  page.evaluate(() => {
    const s = window.__pfg.scene.getScene('arena');
    return { x: s.player.x, y: s.player.y, hp: s.hp, wave: s.wave, score: s.score, kills: s.kills, choosing: s.choosing, over: s.over,
      enemies: s.enemies.countActive(), queue: s.spawnQueue.length, bullets: s.bullets.countActive(), taken: s.taken };
  });

// movement
const s0 = await state();
await page.keyboard.down('KeyW');
await sleep(400);
await page.keyboard.up('KeyW');
let s = await state();
assert.ok(s.y < s0.y - 40, `moved up (${s0.y} → ${s.y})`);

// firing towards the top-left
await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.2);
await page.mouse.down();
await sleep(500);
s = await state();
assert.ok(s.bullets > 0, 'bullets in flight while holding fire');
await page.mouse.up();

// wait for the wave to spawn, then kill everything through the real hit path
await t.waitFor(() => { const s = window.__pfg.scene.getScene('arena'); return s.spawnQueue.length === 0 && s.enemies.countActive() > 0; }, 20000);
await page.evaluate(() => {
  const s = window.__pfg.scene.getScene('arena');
  for (const e of [...s.enemies.getChildren()]) s.hit(e, 999);
});
await sleep(200);
s = await state();
assert.equal(s.choosing, true, 'upgrade choice after clearing wave 1');
assert.ok(s.kills >= 7 && s.score >= 70, `kills ${s.kills} score ${s.score}`);
await page.screenshot({ path: 'e2e/.last-overrun.png' });

await page.keyboard.press('Digit2');
await sleep(200);
s = await state();
assert.equal(s.choosing, false);
assert.equal(s.wave, 2);
assert.equal(s.taken.length, 1, `took an upgrade: ${s.taken}`);

// death path
await page.evaluate(() => { const s = window.__pfg.scene.getScene('arena'); s.invulnUntil = 0; s.damagePlayer(999); });
await t.waitFor(() => window.__pfg.scene.getScene('arena').over);
await t.waitForResult();
console.log('  game over:', await t.status(), await t.boardRows());

await page.keyboard.press('KeyR');
await t.waitFor(() => { const s = window.__pfg.scene.getScene('arena'); return !s.over && s.wave === 1; });
await t.exitAndCheck();
await t.done();
