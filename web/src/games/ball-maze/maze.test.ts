import assert from 'node:assert/strict';
import * as M from './maze.ts';
import { LEVELS } from './levels.ts';

assert.equal(LEVELS.length, 5);
for (const lvl of LEVELS) {
  assert.ok(lvl.walls[lvl.start.r][lvl.start.c] === false);
  assert.ok(lvl.walls[lvl.goal.r][lvl.goal.c] === false);
}

const lvl = LEVELS[0];
const ball = M.spawnBall(lvl);
assert.deepEqual(ball, { x: 1.5, z: 1.5, vx: 0, vz: 0 });

// no tilt: stays put
for (let i = 0; i < 60; i++) M.stepBall(lvl, ball, 0, 0, 1 / 60);
assert.ok(Math.abs(ball.x - 1.5) < 1e-9 && Math.abs(ball.z - 1.5) < 1e-9);

// tilt +x: rolls right and gains speed
for (let i = 0; i < 60; i++) M.stepBall(lvl, ball, 0.3, 0, 1 / 60);
assert.ok(ball.x > 1.6 && ball.vx > 0, `rolled right to ${ball.x}`);

// keep rolling into the east wall: stops short of it, never inside
for (let i = 0; i < 600; i++) M.stepBall(lvl, ball, 0.5, 0, 1 / 60);
assert.ok(ball.x <= lvl.cols - 1 - M.RADIUS + 1e-6, `stopped at wall (${ball.x})`);
assert.ok(ball.x > lvl.cols - 1.5, 'reached the far side');

// hole detection: place the ball right on the hole
const hole = lvl.holes[0];
const b2 = { ...M.centre(hole), vx: 0, vz: 0 };
assert.equal(M.stepBall(lvl, b2, 0, 0, 1 / 60), 'hole');

// goal detection
const b3 = { ...M.centre(lvl.goal), vx: 0, vz: 0 };
assert.equal(M.stepBall(lvl, b3, 0, 0, 1 / 60), 'goal');

// a ball rolling through a corridor is pushed out of walls on both axes
const corridor = LEVELS[1];
const b4 = M.spawnBall(corridor);
for (let i = 0; i < 900; i++) {
  M.stepBall(corridor, b4, 0.4, 0.4, 1 / 60);
  const c = Math.floor(b4.x);
  const r = Math.floor(b4.z);
  assert.ok(!corridor.walls[r][c], `never inside a wall (${b4.x.toFixed(2)}, ${b4.z.toFixed(2)})`);
}

assert.equal(M.levelScore(0), 1500);
assert.equal(M.levelScore(10), 1250);
assert.equal(M.levelScore(500), 150);

console.log('maze.test.ts: all assertions passed');
