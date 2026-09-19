import type { LevelDef, Platform } from './physics.ts';

/** Levels are data. Courses run toward −z and upward; the camera trails from +z. */

let nextId = 1;
const box = (x: number, y: number, z: number, w: number, d: number, extra: Partial<Platform> = {}): Platform => ({
  id: nextId++,
  x, y, z, w, d,
  h: extra.h ?? 1,
  ...extra
});
const coin = (x: number, y: number, z: number) => ({ x, y, z, taken: false });

export const LEVELS: LevelDef[] = [
  {
    name: 'First steps',
    spawn: { x: 0, y: 1, z: 0 },
    killY: -8,
    platforms: [
      box(0, 0, 0, 6, 6),
      box(0, 0, -8, 4, 4),
      box(4, 1, -15, 4, 4),
      box(-2, 2, -22, 4, 4, { move: { axis: 'x', amp: 3, period: 4 } }),
      box(-2, 3, -30, 3, 3),
      box(2, 3, -37, 5, 5, { kind: 'goal', h: 1 })
    ],
    coins: [coin(0, 1.5, -8), coin(4, 2.5, -15), coin(-2, 3.5, -22), coin(-2, 4.5, -30)]
  },
  {
    name: 'The crossing',
    spawn: { x: 0, y: 1, z: 0 },
    killY: -8,
    platforms: [
      box(0, 0, 0, 5, 5),
      box(0, 0, -7, 2, 2),
      box(0, 0, -13, 2, 2),
      box(0, 0.5, -20, 3, 3, { kind: 'checkpoint' }),
      box(0, 0.5, -28, 2.5, 2.5, { move: { axis: 'x', amp: 5, period: 5 } }),
      box(0, 1, -36, 2.5, 2.5, { move: { axis: 'x', amp: 5, period: 5, phase: 1 } }),
      box(0, 1.5, -44, 3, 3, { kind: 'checkpoint' }),
      box(-4, 2.5, -50, 2, 2),
      box(4, 3.5, -50, 2, 2),
      box(0, 4.5, -56, 2, 2),
      box(0, 4.5, -63, 5, 5, { kind: 'goal' })
    ],
    coins: [coin(0, 1.5, -7), coin(0, 1.5, -13), coin(0, 2, -28), coin(0, 2.5, -36), coin(-4, 4, -50), coin(4, 5, -50), coin(0, 6, -56)]
  },
  {
    name: 'Ascent',
    spawn: { x: 0, y: 1, z: 0 },
    killY: -8,
    platforms: [
      box(0, 0, 0, 5, 5),
      box(0, 1, -6, 2, 2, { move: { axis: 'y', amp: 2, period: 4 } }),
      box(0, 4, -12, 3, 3, { kind: 'checkpoint' }),
      box(5, 5, -12, 2, 2),
      box(9, 6.5, -12, 2, 2, { move: { axis: 'z', amp: 3, period: 4 } }),
      box(9, 8, -20, 3, 3, { kind: 'checkpoint' }),
      box(4, 9, -24, 2, 2),
      box(-1, 10, -24, 2, 2, { move: { axis: 'y', amp: 1.5, period: 3 } }),
      box(-6, 12, -24, 2, 2),
      box(-6, 12, -31, 5, 5, { kind: 'goal' })
    ],
    coins: [coin(0, 2.5, -6), coin(5, 6.5, -12), coin(9, 8, -12), coin(4, 10.5, -24), coin(-1, 11.5, -24), coin(-6, 13.5, -24)]
  }
];
