import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

export const BASE = process.env.PFG_URL ?? 'http://localhost:5173';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { assert };

/**
 * Headless Chrome with WebGL disabled: Phaser falls back to Canvas and Three.js
 * games run their own guard, which keeps the suite deterministic on machines
 * without a GPU. Console errors are collected and asserted empty at the end.
 */
export async function launch() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--window-size=1280,900',
      // PFG_WEBGL=1 renders through SwiftShader for visual checks; default disables WebGL for determinism.
      ...(process.env.PFG_WEBGL ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-webgl'])
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('console', (m) => {
    const text = m.text();
    // Expected noise: SwiftShader perf warnings, and Three reporting the WebGL context we disabled on purpose.
    const expected = text.includes('GL Driver Message') || (!process.env.PFG_WEBGL && text.includes('THREE.WebGLRenderer') && /WebGL context/.test(text));
    if ((m.type() === 'error' || m.type() === 'warning') && !expected) {
      errors.push(`[${m.type()}] ${text}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  const waitFor = async (fn, timeout = 15000, arg) => {
    const t0 = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg);
      if (v) return v;
      if (Date.now() - t0 > timeout) {
        throw new Error(`waitFor timed out: ${fn.toString().slice(0, 100)}\nerrors: ${JSON.stringify(errors)}`);
      }
      await sleep(200);
    }
  };

  const openGame = async (id) => {
    await page.goto(`${BASE}/#/play/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.stage canvas', { timeout: 20000 });
    await sleep(500);
    const box = await page.$eval('.stage canvas', (n) => {
      const b = n.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    return box;
  };

  const status = () => page.$eval('.status', (n) => n.textContent);
  const boardRows = () => page.$$eval('.board__row', (n) => n.map((r) => r.textContent));
  const waitForResult = () => waitFor(() => /best \d/.test(document.querySelector('.status')?.textContent ?? ''), 20000);

  const exitAndCheck = async () => {
    await page.click('.playbar .button--ghost');
    await page.waitForSelector('.grid');
    await sleep(400);
    assert.equal(await page.$$eval('canvas', (n) => n.length), 0, 'canvas removed on exit');
  };

  const done = async () => {
    assert.deepEqual(errors, [], 'no console errors');
    await browser.close();
  };

  return { browser, page, errors, waitFor, openGame, status, boardRows, waitForResult, exitAndCheck, done };
}

/** Map a logical Phaser coordinate to a screen point inside the canvas box. */
export const toScreen = (box, logicalW, x, y) => {
  const s = box.w / logicalW;
  return { x: box.x + x * s, y: box.y + y * s };
};
