import assert from 'node:assert/strict';
import * as A from './arena.js';

const DT = 1 / 20;
const run = (arena, seconds) => { for (let i = 0; i < seconds / DT; i++) A.step(arena, DT); };

// waits with one player; starts once two are present
const arena = A.createArena();
A.addPlayer(arena, 'a', 'Ali');
run(arena, 1);
assert.equal(arena.phase, 'waiting');
A.addPlayer(arena, 'b', 'Bo');
A.step(arena, DT);
assert.equal(arena.phase, 'round');

// input moves a player
const a = arena.players.get('a');
Object.assign(a, { x: 0, z: 0, vx: 0, vz: 0 });
const b = arena.players.get('b');
Object.assign(b, { x: 30, z: 30 }); // parked far away... but still on the disc? no: keep it simple, move b out of the way
b.x = 0; b.z = 3; // sits nearby, idle
A.setInput(arena, 'a', { dx: 1, dz: 0 });
run(arena, 0.5);
assert.ok(a.x > 1.5, `moved right (${a.x})`);
assert.ok(Math.hypot(a.vx, a.vz) <= 9.01, 'speed capped');

// a shove pushes the other player and records credit
Object.assign(a, { x: -1.6, z: 0, vx: 0, vz: 0 });
Object.assign(b, { x: 0, z: 0, vx: 0, vz: 0 });
A.setInput(arena, 'a', { dx: 1, dz: 0, dash: true });
A.setInput(arena, 'b', { dx: 0, dz: 0 });
run(arena, 0.4);
assert.ok(b.x > 0.5, `b shoved along +x (${b.x})`);
assert.equal(b.lastHitBy, 'a');

// falling off the disc knocks out, credits the shover, and respawns later
Object.assign(b, { x: arena.radius + 0.1, z: 0, vx: 6, vz: 0 });
b.lastHitBy = 'a';
b.lastHitAt = arena.time;
A.step(arena, DT);
assert.equal(b.alive, false);
assert.equal(a.kos, 1);
assert.equal(b.falls, 1);
run(arena, 3);
assert.equal(b.alive, true, 'respawned');
assert.ok(Math.hypot(b.x, b.z) < arena.radius, 'inside the disc');

// the disc shrinks over the round and the round ends in results
const r0 = arena.radius;
run(arena, 20);
assert.ok(arena.radius < r0);
for (let i = 0; i < 70 / DT && arena.phase !== 'results'; i++) A.step(arena, DT);
assert.equal(arena.phase, 'results');
run(arena, A.RESULTS_S + 0.1);
assert.equal(arena.phase, 'round', 'new round starts');
assert.equal(a.kos, 0, 'scores reset each round');

// bots fill the arena while a human is present, and leave when none are
const solo = A.createArena();
A.addPlayer(solo, 'h', 'Human');
A.balanceBots(solo);
assert.equal(solo.players.size, A.MIN_PLAYERS);
run(solo, 2);
assert.equal(solo.phase, 'round');
const bots = [...solo.players.values()].filter((p) => p.bot);
assert.ok(bots.every((p) => Math.hypot(p.x, p.z) <= solo.radius + 1), 'bots stay roughly on the disc');
A.removePlayer(solo, 'h');
A.balanceBots(solo);
assert.equal(solo.players.size, 0);

// snapshot is compact and serialisable
const snap = A.snapshot(arena);
assert.ok(snap.players.length === 2 && typeof JSON.stringify(snap) === 'string');

console.log('arena.test.js: all assertions passed');
