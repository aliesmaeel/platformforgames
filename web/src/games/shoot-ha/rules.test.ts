import assert from 'node:assert/strict';
import * as R from './rules.ts';

// world: 5 discs each side and a ball at the centre
const w = R.createWorld();
assert.equal(w.bodies.length, 11);
assert.equal(w.bodies.filter((b) => b.team === 0).length, 5);
assert.deepEqual([w.ball.x, w.ball.y], [R.W / 2, R.H / 2]);

// walls: a disc fired at the top edge bounces back with damping
const d = w.bodies[0];
Object.assign(d, { x: 300, y: 60, vx: 0, vy: -800 });
for (let i = 0; i < 60; i++) R.step(w, R.SIM_STEP);
assert.ok(d.vy > 0 && d.y >= d.r, `bounced off the top (${d.vy.toFixed(0)})`);

// collisions transfer momentum to the ball
const w2 = R.createWorld();
const shooter = w2.bodies[0];
Object.assign(shooter, { x: w2.ball.x - 60, y: w2.ball.y, vx: 900, vy: 0 });
for (let i = 0; i < 30; i++) R.step(w2, R.SIM_STEP); // 1/8 s: struck, not yet at the far keeper
assert.ok(w2.ball.vx > 200, `ball kicked (${w2.ball.vx.toFixed(0)})`);
assert.ok(shooter.vx < 900, 'shooter slowed');

// goals: ball rolling into the right goal scores for team 0; the mouth lets it in, the post does not
const w3 = R.createWorld();
for (const b of w3.bodies) if (!b.ball) b.x = b.team === 0 ? 100 : 900, b.y = 50; // clear the lane
Object.assign(w3.ball, { x: R.W - 60, y: R.H / 2, vx: 900, vy: 0 });
let scored: 0 | 1 | null = null;
for (let i = 0; i < 240 && scored === null; i++) scored = R.step(w3, R.SIM_STEP);
assert.equal(scored, 0);
const w4 = R.createWorld();
for (const b of w4.bodies) if (!b.ball) b.x = b.team === 0 ? 100 : 900, b.y = 50;
Object.assign(w4.ball, { x: R.W - 60, y: 40, vx: 900, vy: 0 }); // above the goal mouth
let s4: 0 | 1 | null = null;
for (let i = 0; i < 240 && s4 === null; i++) s4 = R.step(w4, R.SIM_STEP);
assert.equal(s4, null, 'no goal outside the mouth');
assert.ok(w4.ball.vx < 0, 'rebounded off the end wall');

// discs inside a goal are moved back out to a free spot
const w5 = R.createWorld();
w5.bodies[0].x = -20;
w5.bodies[0].y = R.H / 2;
R.fixDiscsInGoals(w5);
assert.equal(w5.bodies[0].x, 80);
assert.ok(w5.bodies.every((o) => o === w5.bodies[0] || Math.hypot(o.x - 80, o.y - w5.bodies[0].y) >= o.r + R.DISC_R));

// flick: short drags are ignored; long drags cap at MAXV in the pull-back direction
assert.equal(R.flick(w5.bodies[0], w5.bodies[0].x + 5, w5.bodies[0].y), null);
const f = R.flick({ ...w5.bodies[0], x: 100, y: 100 }, 100 - 500, 100)!;
assert.ok(Math.abs(f.vx - R.MAXV) < 1e-6 && Math.abs(f.vy) < 1e-6, 'full-power flick to +x');
assert.ok(R.pickDisc(w5, 0, { x: 80, y: w5.bodies[0].y }) === w5.bodies[0]);
assert.equal(R.pickDisc(w5, 1, { x: 80, y: w5.bodies[0].y }), null, 'cannot pick the other team');

// AI always produces a shot from one of its discs, capped at kick-off
const w6 = R.createWorld();
const shot = R.aiShot(w6, 1, true, () => 0.5);
assert.equal(shot.disc.team, 1);
assert.ok(Math.hypot(shot.vx, shot.vy) <= 850.01, 'kick-off power capped');
const open = R.aiShot(w6, 1, false, () => 0.5);
assert.ok(Math.hypot(open.vx, open.vy) > 850, 'full power when open');

// match flow: kick-off goal is void, then a real goal counts, second goal wins
const m = new R.Match('pvp');
m.begin(0);
assert.equal(m.state, 'aim');
const mine = () => m.world.bodies.find((b) => b.team === 0)!;
const runSim = () => { let ev: R.MatchEvent[] = []; for (let i = 0; i < 20 * 60 && m.state === 'sim'; i++) ev = ev.concat(m.tick(1 / 60)); return ev; };
const scoreShot = () => {
  // Park a disc right behind the ball on the centre line and shoot through an empty lane.
  for (const b of m.world.bodies) if (!b.ball) { b.x = b.team === 0 ? 120 : 880; b.y = 60; }
  Object.assign(m.world.ball, { x: R.W - 200, y: R.H / 2 });
  Object.assign(mine(), { x: R.W - 200 - 45, y: R.H / 2 });
  m.shoot(mine(), 1500, 0);
  return runSim();
};
let ev = scoreShot();
assert.ok(ev.some((e) => e.type === 'nogoal'), 'straight from kick-off does not count');
assert.deepEqual(m.score, [0, 0]);
ev = m.resume();
assert.ok(ev.some((e) => e.type === 'turn' && e.team === 1), 'other side kicks off');
m.turn = 0; m.kickoffPending = false; // hand the ball to blue with kick-off spent
ev = scoreShot();
assert.ok(ev.some((e) => e.type === 'goal' && e.team === 0 && !e.final));
assert.deepEqual(m.score, [1, 0]);
m.resume();
m.turn = 0; m.kickoffPending = false;
ev = scoreShot();
assert.ok(ev.some((e) => e.type === 'goal' && e.final));
ev = m.resume();
assert.ok(ev.some((e) => e.type === 'over' && e.winner === 0));
assert.equal(m.state, 'over');
assert.ok(R.matchScore(m) >= 1200);

// clocks: only the side to move loses time, and running out loses the match
const c = new R.Match('ai');
c.begin(1);
c.tick(5);
assert.ok(c.clocks[1] < R.TIME && c.clocks[0] === R.TIME);
const evc = c.tick(R.TIME);
assert.ok(evc.some((e) => e.type === 'over' && e.winner === 0 && e.why === 'time'));
assert.equal(R.fmtClock(179.2), '3:00');
assert.equal(R.fmtClock(29.5), '0:30');

console.log('rules.test.ts: all assertions passed');
