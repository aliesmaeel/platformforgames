import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page, browser } = t;
await t.openGame('party-arena');
await t.waitFor(() => window.__pfg?.connected && window.__pfg.id);
await t.waitFor(() => window.__pfg.snapshot?.players.length >= 4, 10000);
const me = () => page.evaluate(() => { const g = window.__pfg; return g.snapshot.players.find((p) => p.id === g.id); });
let m = await me();
console.log('  joined as', m.name, 'with', (await page.evaluate(() => window.__pfg.snapshot.players.length)) - 1, 'others');
assert.ok(!m.bot);
await t.waitFor(() => window.__pfg.snapshot.phase === 'round', 10000);

// input moves my player
const x0 = m.x;
await page.keyboard.down('KeyD');
await t.waitFor((x0) => { const g = window.__pfg; const p = g.snapshot.players.find((p) => p.id === g.id); return p && p.x > x0 + 0.8; }, 8000, x0);
await page.keyboard.up('KeyD');
console.log('  moved');

// a second human joins the same room
const page2 = await browser.newPage();
await page2.setViewport({ width: 1280, height: 900 });
await page2.goto(`${process.env.PFG_URL ?? 'http://localhost:5173'}/#/play/party-arena`, { waitUntil: 'load' });
await page2.waitForSelector('.stage canvas', { timeout: 20000 });
await t.waitFor(() => window.__pfg.snapshot.players.filter((p) => !p.bot).length >= 2, 10000);
console.log('  second human visible');
await page.screenshot({ path: 'e2e/.last-knockabout.png' });

// round ends (PFG_ROUND_S=8 in the e2e runner) and a score is submitted
await t.waitFor(() => window.__pfg.rounds >= 1, 20000);
await t.waitForResult();
console.log('  round over:', await t.status(), await t.boardRows());
await page2.close();
await sleep(300);
await t.waitFor(() => window.__pfg.snapshot.players.filter((p) => !p.bot).length === 1, 8000);

await t.exitAndCheck();
await t.done();
