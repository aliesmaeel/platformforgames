/**
 * Stacking rules: a block slides over the one below; on drop the overhang is
 * sliced off. Near-perfect drops snap and count toward a combo that regrows
 * the block.
 */

export interface Slab {
  x: number;
  z: number;
  w: number; // size along x
  d: number; // size along z
}

export type Axis = 'x' | 'z';

export interface DropResult {
  placed: Slab;
  /** The overhang that falls away, if any. */
  cut: Slab | null;
  perfect: boolean;
}

export const PERFECT_TOLERANCE = 0.12;
export const START_SIZE = 3;
export const MAX_SIZE = 3.6;
export const GROW = 0.25;
export const COMBO_FOR_GROWTH = 3;

/** Returns null when the moving slab misses the one below entirely. */
export function drop(below: Slab, moving: Slab, axis: Axis): DropResult | null {
  const size = axis === 'x' ? 'w' : 'd';
  const delta = moving[axis] - below[axis];
  const overlap = below[size] - Math.abs(delta);
  if (overlap <= 0) return null;

  if (Math.abs(delta) <= PERFECT_TOLERANCE) {
    return { placed: { ...moving, [axis]: below[axis], [size]: below[size] }, cut: null, perfect: true };
  }

  const placed: Slab = { ...moving, [size]: overlap, [axis]: below[axis] + delta / 2 };
  const cutSize = Math.abs(delta);
  // The overhang sits just beyond the placed piece's edge on the side it drifted to.
  const cut: Slab = { ...moving, [size]: cutSize, [axis]: placed[axis] + Math.sign(delta) * (overlap / 2 + cutSize / 2) };
  return { placed, cut, perfect: false };
}

/** Grow the slab after a combo streak, capped. */
export function grown(slab: Slab, axis: Axis): Slab {
  const size = axis === 'x' ? 'w' : 'd';
  return { ...slab, [size]: Math.min(MAX_SIZE, slab[size] + GROW) };
}

/** Slide speed rises with height but stays playable. */
export const speedFor = (level: number): number => Math.min(7.5, 3 + level * 0.18);

/** Slide range so the block starts fully off the tower. */
export const amplitudeFor = (below: Slab, axis: Axis): number => (axis === 'x' ? below.w : below.d) / 2 + 2.6;
