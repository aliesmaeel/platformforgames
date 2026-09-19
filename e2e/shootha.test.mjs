import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;
await t.openGame('shoot-ha');
await t.waitFor(() => !!window.__pfg && !document.querySelector('[data-el="menu"]').hidden);
assert.equal(await t.status(), 'pick a mode');

// two-player mode names the sides Blue and Red; go back to the menu
await page.click('[data-el="bPVP"]');
await t.waitFor(() => document.querySelector('[data-el="n0"]').textContent === 'Blue');
await page.evaluate(() => document.querySelector('[data-el="bMenu"]').click());
await sleep(50);

// play the computer: coin toss, then someone kicks off
await page.click('[data-el="bAI"]');
await t.waitFor(() => window.__pfg.match?.state === 'aim', 8000);
// If the computer kicks off, let its shot play out until it is our turn.
await t.waitFor(() => { const m = window.__pfg.match; return m.state === 'aim' && m.turn === 0; }, 30000);
const clock0 = await page.evaluate(() => window.__pfg.match.clocks[0]);

// real drag-to-flick on one of our discs
const disc = await page.evaluate(() => { const g = window.__pfg; const d = g.match.world.bodies.find((b) => b.team === 0); return { ...g.toScreen(d.x, d.y), wx: d.x, wy: d.y }; });
await page.mouse.move(disc.x, disc.y);
await page.mouse.down();
await page.mouse.move(disc.x - 60, disc.y + 10, { steps: 6 });
await sleep(100);
await page.mouse.up();
await t.waitFor(() => window.__pfg.match.state === 'sim', 5000);
console.log('  flicked a disc');
await t.waitFor(() => window.__pfg.match.state !== 'sim', 20000);
const clock1 = await page.evaluate(() => window.__pfg.match.clocks[0]);
assert.ok(clock1 < clock0, 'our clock ran while aiming');

// score twice by lining a disc up behind the ball on our turn
for (let goals = 1; goals <= 2; goals++) {
  await t.waitFor(() => { const m = window.__pfg.match; return m.state === 'aim' && m.turn === 0; }, 40000);
  await page.evaluate(() => {
    const g = window.__pfg; const m = g.match;
    m.kickoffPending = false;
    for (const b of m.world.bodies) if (!b.ball) { b.x = b.team === 0 ? 120 : 880; b.y = 60; }
    Object.assign(m.world.ball, { x: 800, y: 300 });
    const d = m.world.bodies.find((b) => b.team === 0);
    Object.assign(d, { x: 755, y: 300 });
    g.shoot(d, 1500, 0);
  });
  await t.waitFor((n) => window.__pfg.match.score[0] === n, 20000, goals);
  console.log(`  goal ${goals}`);
  if (goals === 1) await page.screenshot({ path: 'e2e/.last-shootha.png' });
}
await t.waitFor(() => window.__pfg.match.state === 'over', 10000);
assert.equal(await page.$eval('[data-el="ot"]', (n) => n.textContent), 'You win');
await t.waitFor(() => /rank #/.test(document.querySelector('.status')?.textContent ?? ''), 10000);
console.log('  match over:', await t.status(), await t.boardRows());
const rows = await t.boardRows();
assert.ok(rows.length >= 1 && /1,[0-9]{3}/.test(rows[0]), 'win scored over 1000');

await page.keyboard.press('KeyR');
await t.waitFor(() => window.__pfg.match && window.__pfg.match.score[0] === 0 && window.__pfg.match.state !== 'over');
await t.exitAndCheck();
await t.done();
