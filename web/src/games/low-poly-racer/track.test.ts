import assert from 'node:assert/strict';
import * as T from './track.ts';

const samples = T.sampleTrack();
assert.equal(samples.length, T.CONTROL.length * 24);
assert.ok(samples[samples.length - 1].dist > 200, 'track is a few hundred metres');
for (const s of samples) assert.ok(Math.abs(Math.hypot(s.tx, s.tz) - 1) < 1e-6, 'unit tangents');

// nearest: on the centre line, lateral 0; offset to the side, lateral has the right sign and size
const s100 = samples[100];
const on = T.nearest(samples, s100, 0);
assert.equal(on.index, 100);
assert.ok(Math.abs(on.lateral) < 1e-6);
const nx = -s100.tz; // left normal
const nz = s100.tx;
const left = T.nearest(samples, { x: s100.x + nx * 2, z: s100.z + nz * 2 }, 100);
assert.ok(Math.abs(Math.abs(left.lateral) - 2) < 0.15, `lateral ≈ 2 (${left.lateral})`);
assert.ok(T.onTrack(left));
const far = T.nearest(samples, { x: s100.x + nx * 5, z: s100.z + nz * 5 }, 100);
assert.ok(!T.onTrack(far), 'off the 7 m road');
// hint far away still finds the right sample
assert.equal(T.nearest(samples, s100, 300).index, 100);
// progress increases along the loop
assert.ok(T.nearest(samples, samples[200], 0).progress > T.nearest(samples, samples[50], 0).progress);

// car: accelerates, is capped, slows on grass, turns only when moving
const car = T.spawnCar(samples);
for (let i = 0; i < 600; i++) T.stepCar(car, { throttle: 1, brake: 0, steer: 0 }, false, 1 / 60);
assert.ok(car.speed > 20 && car.speed <= 30.01, `fast (${car.speed})`);
const h0 = car.heading;
T.stepCar(car, { throttle: 1, brake: 0, steer: 1 }, false, 1 / 60);
assert.ok(car.heading !== h0, 'steers at speed');
for (let i = 0; i < 300; i++) T.stepCar(car, { throttle: 1, brake: 0, steer: 0 }, true, 1 / 60);
assert.ok(car.speed <= 11.5, `grass caps speed (${car.speed})`);
const stopped: T.Car = { x: 0, z: 0, heading: 0, speed: 0 };
T.stepCar(stopped, { throttle: 0, brake: 0, steer: 1 }, false, 1 / 60);
assert.equal(stopped.heading, 0, 'no steering when stopped');

// laps: gates must be passed in order; crossing the line backwards does not count
const laps = T.newLapState(0);
let t = 0;
for (const p of [0.1, 0.3, 0.55, 0.8, 0.95, 0.02]) assert.equal(T.updateLaps(laps, p, (t += 1000)), p === 0.02 ? 6000 : null);
assert.equal(laps.lap, 1);
assert.deepEqual(laps.lapTimes, [6000]);
const cheat = T.newLapState(0);
T.updateLaps(cheat, 0.95, 100);
assert.equal(T.updateLaps(cheat, 0.02, 200), null, 'no gates, no lap');
assert.equal(cheat.lap, 0);

assert.equal(T.scoreToLap(T.lapToScore(83456)), 83456);
assert.equal(T.fmtTime(83456), '1:23.46');
assert.ok(T.lapToScore(60000) > T.lapToScore(90000), 'faster lap scores higher');

console.log('track.test.ts: all assertions passed');
