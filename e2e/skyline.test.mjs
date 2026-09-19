import { launch, assert, sleep } from './lib.mjs';

const t = await launch();
const { page } = t;
await t.openGame('stack-tower');
await t.waitFor(() => !!window.__pfg?.current);
assert.equal(await t.status(), 'stack it high');

const state = () => page.evaluate(() => { const g = window.__pfg; return { count: g.count, score: g.score, combo: g.combo, over: g.over, axis: g.axis, below: { ...g.below }, current: { ...g.current } }; });

// the block is moving
const a = await state();
await t.waitFor((c0) => Math.abs(window.__pfg.current[window.__pfg.axis] - c0) > 0.3, 8000, a.current[a.axis]);

// perfect drop: park exactly over the base
await page.evaluate(() => { const g = window.__pfg; g.setCurrent(g.below.x, g.below.z); g.tap(); });
let s = await state();
assert.equal(s.count, 1);
assert.equal(s.score, 2, 'perfect pays 2');
assert.equal(s.combo, 1);

// offset drop trims the slab along the new axis
await page.evaluate(() => { const g = window.__pfg; g.setCurrent(g.below.x + (g.axis === 'x' ? 1 : 0), g.below.z + (g.axis === 'z' ? 1 : 0)); g.tap(); });
s = await state();
assert.equal(s.count, 2);
assert.equal(s.combo, 0);
const size = s.axis === 'x' ? s.below.d : s.below.w; // size along the axis just dropped on (axis has since flipped)
assert.ok(Math.abs(size - 2) < 1e-6, `trimmed to 2 (${size})`);
await sleep(300);
await page.screenshot({ path: 'e2e/.last-skyline.png' });

// three perfects in a row regrow the slab
for (let i = 0; i < 3; i++) await page.evaluate(() => { const g = window.__pfg; g.setCurrent(g.below.x, g.below.z); g.tap(); });
s = await state();
assert.equal(s.combo, 3);
assert.ok(Math.max(s.below.w, s.below.d) > 2, `regrown (${s.below.w} × ${s.below.d})`);

// miss ends the run
await page.evaluate(() => { const g = window.__pfg; g.setCurrent(g.below.x + 10, g.below.z + 10); g.tap(); });
s = await state();
assert.equal(s.over, true);
await t.waitForResult();
console.log('  toppled:', await t.status(), await t.boardRows());

await page.keyboard.press('KeyR');
await t.waitFor(() => !window.__pfg.over && window.__pfg.count === 0);
await t.exitAndCheck();
await t.done();
