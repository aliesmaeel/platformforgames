/** Contract every game on the platform implements. */

export interface ScoreEntry {
  rank: number;
  player: string;
  score: number;
  created: number;
}

export interface ScoreResult {
  rank: number;
  best: number;
  offline: boolean;
}

/** What the shell hands a game when it mounts. */
export interface GameContext {
  /** Display name of the current player. */
  player: string;
  /** Submit a run's score to this game's leaderboard. */
  submitScore(score: number): Promise<ScoreResult | null>;
  /** Ask the shell to tear the game down and go back to the catalog. */
  exit(): void;
  /** Write a short line into the shell's HUD (e.g. "best: 1240"). */
  setStatus(text: string): void;
}

export interface GameHandle {
  /** Release canvases, listeners, timers. Called on navigation away. */
  destroy(): void | Promise<void>;
}

export interface GameModule {
  /** Take over `container` (already sized by the shell) and start running. */
  mount(container: HTMLElement, ctx: GameContext): GameHandle | Promise<GameHandle>;
}

export interface GameMeta {
  /** Kebab-case; doubles as the leaderboard key on the server. */
  id: string;
  title: string;
  blurb: string;
  dimension: '2D' | '3D';
  mood: string;
  /** Rough build effort, 1 (a weekend) to 5 (a season). */
  effort: 1 | 2 | 3 | 4 | 5;
  accent: string;
  /** Present once the game is playable; absent means "on the roadmap". */
  load?: () => Promise<{ default: GameModule }>;
}
