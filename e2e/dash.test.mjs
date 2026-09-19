import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;

await page.goto(`${process.env.PFG_URL ?? 'http://localhost:5173'}/#/`, { waitUntil: 'load' });
await page.waitForSelector('.card');
const playable = await page.$$eval('.card .button', (n) => n.length);
console.log('  catalog playable:', playable);
assert.ok(playable >= 1);

await t.openGame('endless-runner');
assert.equal(await t.status(), 'good luck');

const t0 = Date.now();
while (Date.now() - t0 < 5000) {
  await page.keyboard.press('Space');
  await sleep(450);
}
const distance = await page.evaluate(() => window.__pfg.scene.getScene('run').distance);
assert.ok(distance > 500, `ran some distance (${distance})`);

await t.waitForResult();
await sleep(500);
const rows = await t.boardRows();
console.log('  after death:', await t.status(), rows);
assert.ok(rows.length >= 1);

await page.keyboard.press('KeyR');
await sleep(800);
assert.equal(await page.evaluate(() => window.__pfg.scene.getScene('run').dead), false, 'restarted');

await t.exitAndCheck();
await t.done();
