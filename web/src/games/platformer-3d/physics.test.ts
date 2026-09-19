import assert from 'node:assert/strict';
import * as P from './physics.ts';

const level: P.LevelDef = {
  name: 'test',
  spawn: { x: 0, y: 1, z: 0 },
  killY: -10,
  platforms: [
    { id: 1, x: 0, y: 0, z: 0, w: 6, h: 1, d: 6 },
    { id: 2, x: 8, y: 0, z: 0, w: 4, h: 1, d: 4 },
    { id: 3, x: 0, y: 0, z: 10, w: 4, h: 1, d: 4, move: { axis: 'x', amp: 3, period: 4 } },
    { id: 4, x: 20, y: 0, z: 0, w: 4, h: 1, d: 4, kind: 'goal' },
    { id: 5, x: 0, y: 1, z: -4, w: 2, h: 1, d: 2 }
  ],
  coins: [{ x: 3, y: 1.5, z: 0, taken: false }]
};
const idle: P.Input = { mx: 0, mz: 0, jump: false, jumpPressed: false };
const DT = 1 / 120;
const run = (pl: P.Player, input: P.Input, seconds: number, t0 = 0) => {
  let last: P.StepResult = { fell: false, coins: [], goal: false, checkpoint: null };
  const events: P.StepResult[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    last = P.step(pl, input, level, t0 + i * DT, DT);
    events.push(last);
  }
  return { last, events };
};

// falls onto the ground platform and rests on top
const pl = P.spawnPlayer({ x: 0, y: 3, z: 0 });
run(pl, idle, 1);
assert.ok(pl.grounded && pl.groundId === 1);
assert.ok(Math.abs(pl.y - 0.5) < 1e-6, `stands on top (${pl.y})`);

// walking: reaches a steady speed, stops at the platform edge when it walks off (falls)
run(pl, { ...idle, mx: 1 }, 0.5);
assert.ok(pl.vx > 7, `up to speed (${pl.vx})`);
assert.ok(pl.x > 2, 'moved');

// jump from ground: rises, then lands again
const j = P.spawnPlayer({ x: 0, y: 0.5, z: 0 });
run(j, idle, 0.2);
assert.ok(j.grounded);
P.step(j, { ...idle, jump: true, jumpPressed: true }, level, 0, DT);
assert.ok(j.vy > 10, 'jumped');
let peak = 0;
for (let i = 0; i < 240; i++) {
  P.step(j, { ...idle, jump: true }, level, 0, DT);
  peak = Math.max(peak, j.y);
}
assert.ok(peak > 2.2 && peak < 3, `jump height ${peak}`);
assert.ok(j.grounded, 'landed');

// short hop when jump is released early
const h = P.spawnPlayer({ x: 0, y: 0.5, z: 0 });
run(h, idle, 0.2);
P.step(h, { ...idle, jump: true, jumpPressed: true }, level, 0, DT);
let hop = 0;
for (let i = 0; i < 240; i++) {
  P.step(h, idle, level, 0, DT);
  hop = Math.max(hop, h.y);
}
assert.ok(hop < peak - 0.8, `short hop ${hop} < full ${peak}`);

// coyote time: walk off the edge then jump within the window
const c = P.spawnPlayer({ x: 3.3, y: 0.5, z: 0 });
run(c, idle, 0.2);
assert.ok(c.grounded, 'starts on the ledge');
c.vx = 7.5;
for (let i = 0; i < 4; i++) P.step(c, { ...idle, mx: 1 }, level, 0, DT); // carries past the 3.4 edge
assert.ok(!c.grounded, `in the air (x=${c.x})`);
P.step(c, { ...idle, mx: 1, jump: true, jumpPressed: true }, level, 0, DT);
assert.ok(c.vy > 10, 'coyote jump allowed');

// jump buffer: press just before landing
const b = P.spawnPlayer({ x: 0, y: 0.62, z: 0 }); // 0.12 m above the deck: lands within the buffer window
P.step(b, { ...idle, jump: true, jumpPressed: true }, level, 0, DT);
assert.ok(!b.grounded && b.vy < 0);
let maxVy = -Infinity;
for (let i = 0; i < 0.3 / DT; i++) {
  P.step(b, { ...idle, jump: true }, level, 0, DT);
  maxVy = Math.max(maxVy, b.vy);
}
assert.ok(maxVy > 5, `buffered jump fired on landing (${maxVy})`);

// moving platform carries the player
const m = P.spawnPlayer({ x: 0, y: 2, z: 10 });
run(m, idle, 0.5, 0); // lands around t=0.5, platform near x=0 moving
const xBefore = m.x;
run(m, idle, 0.5, 0.5);
assert.ok(m.grounded && m.groundId === 3, 'on the mover');
assert.ok(Math.abs(m.x - xBefore) > 0.5, `carried (${xBefore} → ${m.x})`);

// walls: cannot pass through a platform's side
const w = P.spawnPlayer({ x: 0, y: 0.5, z: 0 });
run(w, idle, 0.2);
run(w, { ...idle, mz: -1 }, 1.5);
assert.ok(w.z > -3.5, 'blocked by the raised block' + w.z);

// coins and goal (the walking test above already ran through this coin, so reset it)
level.coins[0].taken = false;
const k = P.spawnPlayer({ x: 2.5, y: 0.5, z: 0 });
const kr = run(k, { ...idle, mx: 0.2 }, 0.3);
assert.ok(kr.events.some((e) => e.coins.length === 1), 'coin taken');
assert.ok(level.coins[0].taken);
const g = P.spawnPlayer({ x: 20, y: 2, z: 0 });
const gr = run(g, idle, 0.6);
assert.ok(gr.events.some((e) => e.goal), 'goal reached');

// falling out of the world
const f = P.spawnPlayer({ x: 50, y: 0, z: 50 });
const fr = run(f, idle, 1.5);
assert.ok(fr.events.some((e) => e.fell));

assert.equal(P.timeBonus(0), 1200);
assert.equal(P.timeBonus(100), 0);
console.log('physics.test.ts: all assertions passed');
