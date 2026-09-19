/**
 * Racing rules with no rendering: a closed spline track, the car model,
 * lap/checkpoint accounting and lap-time scoring.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Sample extends Vec2 {
  tx: number; // unit tangent
  tz: number;
  dist: number; // distance along the track from the start line
}

export const TRACK_WIDTH = 7;
export const LAPS = 3;

/** Control points of the loop (counter-clockwise), roughly 240 m around. */
export const CONTROL: Vec2[] = [
  { x: 0, z: 40 }, { x: 30, z: 42 }, { x: 52, z: 30 }, { x: 58, z: 8 }, { x: 48, z: -12 },
  { x: 56, z: -34 }, { x: 36, z: -48 }, { x: 8, z: -40 }, { x: -12, z: -52 }, { x: -40, z: -44 },
  { x: -54, z: -18 }, { x: -44, z: 6 }, { x: -52, z: 28 }, { x: -30, z: 44 }
];

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Evenly-ish spaced samples along the closed Catmull-Rom loop. */
export function sampleTrack(control: Vec2[] = CONTROL, perSegment = 24): Sample[] {
  const n = control.length;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n];
    const p1 = control[i];
    const p2 = control[(i + 1) % n];
    const p3 = control[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      pts.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  const samples: Sample[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    if (i > 0) dist += Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z);
    samples.push({ ...pts[i], tx: tx / len, tz: tz / len, dist });
  }
  return samples;
}

export interface Nearest {
  index: number;
  /** Signed lateral offset from the centre line (metres). */
  lateral: number;
  /** 0..1 around the loop. */
  progress: number;
}

/** Closest sample to a point, searching near `hint` first for speed. */
export function nearest(samples: Sample[], p: Vec2, hint = 0): Nearest {
  const n = samples.length;
  let best = hint;
  let bestD = Infinity;
  const window = 40;
  const check = (i: number) => {
    const s = samples[((i % n) + n) % n];
    const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = ((i % n) + n) % n;
    }
  };
  for (let i = hint - window; i <= hint + window; i++) check(i);
  if (bestD > 30 * 30) for (let i = 0; i < n; i++) check(i);
  const s = samples[best];
  // Lateral sign from the cross product of tangent and offset.
  const ox = p.x - s.x;
  const oz = p.z - s.z;
  const lateral = s.tx * oz - s.tz * ox;
  const total = samples[n - 1].dist + Math.hypot(samples[0].x - samples[n - 1].x, samples[0].z - samples[n - 1].z);
  return { index: best, lateral, progress: s.dist / total };
}

export const onTrack = (near: Nearest): boolean => Math.abs(near.lateral) <= TRACK_WIDTH / 2;

// ---------- car ----------

export interface Car {
  x: number;
  z: number;
  heading: number; // radians, 0 = +x
  speed: number; // m/s, signed
}

export interface Input {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
}

const ACCEL = 14;
const BRAKE = 24;
const DRAG = 0.55;
const MAX = 30;
const GRASS_MAX = 11;
const GRASS_DRAG = 2.2;
const TURN = 2.3;

export function spawnCar(samples: Sample[]): Car {
  const s = samples[0];
  return { x: s.x, z: s.z, heading: Math.atan2(s.tz, s.tx), speed: 0 };
}

export function stepCar(car: Car, input: Input, grass: boolean, dt: number): void {
  const max = grass ? GRASS_MAX : MAX;
  car.speed += input.throttle * ACCEL * dt;
  car.speed -= Math.sign(car.speed) * input.brake * BRAKE * dt;
  car.speed -= car.speed * (grass ? GRASS_DRAG : DRAG) * dt;
  if (Math.abs(car.speed) > max) car.speed = Math.sign(car.speed) * Math.max(max, Math.abs(car.speed) - 30 * dt);
  if (Math.abs(car.speed) < 0.02 && input.throttle === 0) car.speed = 0;
  // Steering authority scales with speed so the car cannot spin on the spot.
  const authority = Math.min(1, Math.abs(car.speed) / 8);
  car.heading -= input.steer * TURN * authority * Math.sign(car.speed || 1) * dt;
  car.x += Math.cos(car.heading) * car.speed * dt;
  car.z += Math.sin(car.heading) * car.speed * dt;
}

// ---------- laps ----------

export interface LapState {
  lap: number; // completed laps
  checkpoints: boolean[]; // 3 gates at 25/50/75 %
  lastProgress: number;
  lapStart: number; // ms
  lapTimes: number[];
}

export const newLapState = (now: number): LapState => ({ lap: 0, checkpoints: [false, false, false], lastProgress: 0, lapStart: now, lapTimes: [] });

/** Feed progress each frame; returns the finished lap time when a lap completes. */
export function updateLaps(state: LapState, progress: number, now: number): number | null {
  const gates = [0.25, 0.5, 0.75];
  gates.forEach((g, i) => {
    if (!state.checkpoints[i] && state.lastProgress < g && progress >= g && progress - state.lastProgress < 0.5) state.checkpoints[i] = true;
  });
  let finished: number | null = null;
  const crossedStart = state.lastProgress > 0.85 && progress < 0.15;
  if (crossedStart && state.checkpoints.every(Boolean)) {
    finished = now - state.lapStart;
    state.lap++;
    state.lapTimes.push(finished);
    state.lapStart = now;
    state.checkpoints = [false, false, false];
  } else if (crossedStart) {
    // Crossed the line backwards or after skipping gates: no lap.
  }
  state.lastProgress = progress;
  return finished;
}

/** Leaderboards sort high-to-low, so a lap time becomes points. */
export const LAP_CEILING_MS = 600000;
export const lapToScore = (ms: number): number => Math.max(1, LAP_CEILING_MS - Math.round(ms));
export const scoreToLap = (score: number): number => LAP_CEILING_MS - score;
export const fmtTime = (ms: number): string => {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
};
