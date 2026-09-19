import type { GameMeta } from './types';

/**
 * The catalog. A game becomes playable the moment it gets a `load` function
 * pointing at a module that default-exports a GameModule.
 */
export const CATALOG: GameMeta[] = [
  {
    id: 'endless-runner',
    title: 'Dash',
    blurb: 'Auto-run, jump the crates, duck the beams. It only gets faster.',
    dimension: '2D',
    mood: 'quick hit',
    effort: 1,
    accent: '#4cc9f0',
    load: () => import('../games/endless-runner/index')
  },
  {
    id: 'match-three',
    title: 'Gemline',
    blurb: 'Swap to line up three. Level goals, limited moves.',
    dimension: '2D',
    mood: 'casual',
    effort: 2,
    accent: '#f72585',
    load: () => import('../games/match-three/index')
  },
  {
    id: 'block-drop',
    title: 'Stackfall',
    blurb: 'Falling blocks, clean lines, rising speed.',
    dimension: '2D',
    mood: 'focus',
    effort: 2,
    accent: '#b5179e',
    load: () => import('../games/block-drop/index')
  },
  {
    id: 'arena-shooter',
    title: 'Overrun',
    blurb: 'Top-down waves, WASD and mouse, upgrades between rounds.',
    dimension: '2D',
    mood: 'competitive',
    effort: 3,
    accent: '#ff9f1c',
    load: () => import('../games/arena-shooter/index')
  },
  {
    id: 'tower-defense',
    title: 'Holdfast',
    blurb: 'Place towers, read the path, survive twenty waves.',
    dimension: '2D',
    mood: 'strategy',
    effort: 4,
    accent: '#8ac926',
    load: () => import('../games/tower-defense/index')
  },
  {
    id: 'ball-maze',
    title: 'Tiltway',
    blurb: 'Tilt the maze, roll the ball, mind the holes.',
    dimension: '3D',
    mood: 'relaxing',
    effort: 2,
    accent: '#5eead4',
    load: () => import('../games/ball-maze/index')
  },
  {
    id: 'low-poly-racer',
    title: 'Ridgeline',
    blurb: 'Short arcade tracks, time trials, race your own ghost.',
    dimension: '3D',
    mood: 'competitive',
    effort: 3,
    accent: '#ffd166'
  },
  {
    id: 'stack-tower',
    title: 'Skyline',
    blurb: 'Tap to drop the block. Miss and you lose the overhang.',
    dimension: '3D',
    mood: 'quick hit',
    effort: 2,
    accent: '#a78bfa'
  },
  {
    id: 'platformer-3d',
    title: 'Leapfall',
    blurb: 'Short obstacle courses, moving platforms, collectibles.',
    dimension: '3D',
    mood: 'flagship',
    effort: 4,
    accent: '#60a5fa'
  },
  {
    id: 'party-arena',
    title: 'Knockabout',
    blurb: 'Four to eight players, one shrinking platform, no mercy.',
    dimension: '3D',
    mood: 'social',
    effort: 5,
    accent: '#fb7185'
  }
];

export const findGame = (id: string): GameMeta | undefined =>
  CATALOG.find((game) => game.id === id);
