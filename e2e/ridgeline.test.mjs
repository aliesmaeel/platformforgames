import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;
await t.openGame('low-poly-racer');
await t.waitFor(() => !!window.__pfg?.car);
await t.waitFor(() => window.__pfg.phase === 'race', 12000);

const state = () => page.evaluate(() => { const g = window.__pfg; return { car: { ...g.car }, lap: g.laps.lap, times: g.laps.lapTimes, phase: g.phase, best: g.bestLap, ghost: !!g.ghost }; });

// gas: speed climbs; steer: heading changes
await page.keyboard.down('ArrowUp');
await t.waitFor(() => window.__pfg.car.speed > 5, 8000);
const s1 = await state();
await page.keyboard.down('ArrowLeft');
await t.waitFor((h) => Math.abs(window.__pfg.car.heading - h) > 0.1, 8000, s1.car.heading);
await page.keyboard.up('ArrowLeft');
await page.keyboard.up('ArrowUp');
console.log('  drove: speed', s1.car.speed.toFixed(1), 'm/s');

// three laps by teleporting through the gates in order
const lapTimes = [];
for (let lap = 0; lap < 3; lap++) {
  for (const p of [0.3, 0.55, 0.8, 0.97]) {
    await page.evaluate((p) => window.__pfg.teleport(p), p);
    await t.waitFor((p) => Math.abs(window.__pfg.laps.lastProgress - p) < 0.05, 8000, p);
  }
  await page.evaluate(() => window.__pfg.teleport(0.02));
  await t.waitFor((n) => window.__pfg.laps.lap === n + 1 || window.__pfg.phase === 'over', 8000, lap);
  const s = await state();
  lapTimes.push(s.times[lap]);
  if (lap === 0) assert.ok(s.ghost, 'ghost recorded after first lap');
}
let s = await state();
assert.equal(s.phase, 'over');
assert.equal(s.times.length, 3);
assert.ok(Number.isFinite(s.best) && s.best <= Math.min(...lapTimes) + 1);
await t.waitForResult();
const rows = await t.boardRows();
console.log('  finished:', await t.status(), rows);
assert.ok(/\d:\d\d\.\d\d/.test(rows[0]), 'leaderboard shows a lap time');
await page.screenshot({ path: 'e2e/.last-ridgeline.png' });

// ghost persists across a restart
await page.keyboard.press('KeyR');
await t.waitFor(() => window.__pfg.phase === 'countdown' && window.__pfg.laps.lap === 0);
assert.ok((await state()).ghost);
await t.exitAndCheck();
await t.done();
