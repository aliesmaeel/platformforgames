import { launch, assert, sleep } from './lib.mjs';

/** Two browsers, one relay room: host, join, take turns, score, finish, leave. */
const t = await launch();
const { page, browser } = t;
const BASE = process.env.PFG_URL ?? 'http://localhost:5173';
const errors2 = [];

await t.openGame('shoot-ha');
await t.waitFor(() => !!window.__pfg);
await page.click('[data-el="bHost"]');
const code = await t.waitFor(() => document.querySelector('[data-el="net"] .code')?.textContent || false, 8000);
assert.match(code, /^[A-Z2-9]{4}$/);
console.log('  hosted room', code);

// Second browser context so the guest has its own player name and storage.
const ctx2 = await browser.createBrowserContext();
const page2 = await ctx2.newPage();
await page2.setViewport({ width: 1280, height: 900 });
page2.on('pageerror', (e) => errors2.push(e.message));
await page2.evaluateOnNewDocument(() => localStorage.setItem('pfg:player', 'guest-bo'));
await page2.goto(`${BASE}/#/play/shoot-ha`, { waitUntil: 'load' });
await page2.waitForSelector('.stage canvas', { timeout: 20000 });
await page2.type('[data-el="code"]', code);
await page2.click('[data-el="bJoin"]');

const waitOn = async (pg, fn, arg, timeout = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await pg.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + fn.toString().slice(0, 80));
    await sleep(150);
  }
};
const both = (fn, arg) => Promise.all([waitOn(page, fn, arg), waitOn(page2, fn, arg)]);

await both(() => window.__pfg.match?.mode === 'online' && window.__pfg.match.state === 'aim');
const sides = await Promise.all([page.evaluate(() => window.__pfg.side), page2.evaluate(() => window.__pfg.side)]);
assert.deepEqual(sides, [0, 1]);
const names = await page2.evaluate(() => window.__pfg.names);
assert.equal(names[1], 'guest-bo');
console.log('  both in the match as', names);

// Whoever has the turn shoots; the other browser must replay to the same positions.
const forceGoal = (pg) =>
  pg.evaluate(() => {
    const g = window.__pfg;
    const m = g.match;
    m.kickoffPending = false;
    const me = g.side;
    for (const b of m.world.bodies) if (!b.ball) { b.x = b.team === 0 ? 120 : 880; b.y = 60; }
    const towardX = me === 0 ? 1 : -1;
    Object.assign(m.world.ball, { x: me === 0 ? 800 : 200, y: 300 });
    const d = m.world.bodies.find((b) => b.team === me);
    Object.assign(d, { x: (me === 0 ? 800 : 200) - towardX * 45, y: 300 });
    g.shoot(d, towardX * 1500, 0);
  });

for (let goals = 1; goals <= 3; goals++) {
  if (await page.evaluate(() => window.__pfg.match.state === 'over')) break;
  const turn = await waitOn(page, () => { const m = window.__pfg.match; return m.state === 'aim' ? m.turn + 1 : 0; });
  const shooter = turn - 1 === 0 ? page : page2;
  await waitOn(shooter, () => { const g = window.__pfg; return g.match.state === 'aim' && g.match.turn === g.side; });
  const before = await shooter.evaluate(() => window.__pfg.match.score.slice());
  await forceGoal(shooter);
  await both((n) => window.__pfg.match.score.reduce((a, b) => a + b, 0) === n, before[0] + before[1] + 1, 25000);
  // After a goal each browser stops a few sub-steps apart (settle is checked per frame), then both
  // reset for the kick-off; compare there. The next shot's snapshot resyncs everything regardless.
  await both(() => window.__pfg.match.state === 'aim' || window.__pfg.match.state === 'over');
  const scores = await Promise.all([page.evaluate(() => window.__pfg.match.score), page2.evaluate(() => window.__pfg.match.score)]);
  assert.deepEqual(scores[0], scores[1], 'both browsers agree on the score');
  const states = await Promise.all([page.evaluate(() => window.__pfg.match.state), page2.evaluate(() => window.__pfg.match.state)]);
  if (states.every((x) => x === 'aim')) {
    const pick = () => { const s = window.__pfg.match.snapshot(); return JSON.stringify({ bodies: s.bodies, score: s.score, turn: s.turn }); }; // clocks tick locally
    const worlds = await Promise.all([page.evaluate(pick), page2.evaluate(pick)]);
    assert.equal(worlds[0], worlds[1], 'both browsers line up identically for the kick-off');
  }
  console.log(`  goal ${goals} by side ${turn - 1}:`, scores[0].join('-'), states.join('/'));
  if (goals === 1) await page.screenshot({ path: 'e2e/.last-shootha-online.png' });
}
await both(() => window.__pfg.match.state === 'over');
const titles = await Promise.all([page.$eval('[data-el="ot"]', (n) => n.textContent), page2.$eval('[data-el="ot"]', (n) => n.textContent)]);
console.log('  results:', titles);
assert.ok(titles.filter((x) => x === 'You win').length === 1, 'exactly one winner');
await waitOn(page, () => /rank #/.test(document.querySelector('.status')?.textContent ?? ''));
await waitOn(page2, () => /rank #/.test(document.querySelector('.status')?.textContent ?? ''));
console.log('  boards:', await t.boardRows());

// Guest leaves; host is told.
await page2.close();
await ctx2.close();
await waitOn(page, () => /left/.test(document.querySelector('[data-el="net"]')?.textContent ?? '') || /left/.test(document.querySelector('.status')?.textContent ?? ''), 8000);
assert.deepEqual(errors2, []);
await t.exitAndCheck();
await t.done();
