import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Boots an isolated score service + Vite on spare ports, runs every
 * e2e/*.test.mjs against them, and tears down. Usage: npm run e2e [name…]
 */
const API_PORT = 8790;
const WEB_PORT = 5180;
const root = new URL('..', import.meta.url).pathname;
const db = join(mkdtempSync(join(tmpdir(), 'pfg-e2e-')), 'scores.db');

const procs = [];
const start = (cmd, args, env, cwd) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => process.stderr.write(`[${args[0]}] ${d}`));
  procs.push(p);
  return p;
};
const stop = () => procs.forEach((p) => p.kill());

const waitHttp = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
};

start('node', ['--no-warnings', 'server/src/index.js'], { PORT: String(API_PORT), PFG_DB: db, PFG_ROUND_S: '8' }, root);
start('node', [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(WEB_PORT), '--strictPort'], { PFG_API: `http://localhost:${API_PORT}` }, join(root, 'web'));

try {
  await waitHttp(`http://localhost:${API_PORT}/api/health`);
  await waitHttp(`http://localhost:${WEB_PORT}/`);

  const only = process.argv.slice(2);
  const files = readdirSync(join(root, 'e2e'))
    .filter((f) => f.endsWith('.test.mjs') && (only.length === 0 || only.some((o) => f.includes(o))))
    .sort();

  let failed = 0;
  for (const f of files) {
    const t0 = Date.now();
    const code = await new Promise((resolve) => {
      const p = spawn('node', [join(root, 'e2e', f)], {
        env: { ...process.env, PFG_URL: `http://localhost:${WEB_PORT}`, PFG_API: `http://localhost:${API_PORT}` },
        stdio: 'inherit'
      });
      p.on('exit', resolve);
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${f}  (${secs}s)`);
    if (code !== 0) failed++;
  }
  console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} e2e files passed`);
  process.exitCode = failed ? 1 : 0;
} finally {
  stop();
}
