import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = process.env.PFG_DB ?? resolve(process.cwd(), 'data/scores.db');
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS scores (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id  TEXT    NOT NULL,
    player   TEXT    NOT NULL,
    score    INTEGER NOT NULL,
    created  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (game_id, score DESC, created ASC);
`);

const insert = db.prepare(
  'INSERT INTO scores (game_id, player, score, created) VALUES (?, ?, ?, ?)'
);
const topFor = db.prepare(
  `SELECT player, score, created FROM scores
   WHERE game_id = ?
   ORDER BY score DESC, created ASC
   LIMIT ?`
);
const betterCount = db.prepare(
  'SELECT COUNT(*) AS n FROM scores WHERE game_id = ? AND score > ?'
);
const personalBest = db.prepare(
  'SELECT MAX(score) AS best FROM scores WHERE game_id = ? AND player = ?'
);

export function addScore(gameId, player, score) {
  insert.run(gameId, player, score, Date.now());
  const rank = Number(betterCount.get(gameId, score).n) + 1;
  const best = Number(personalBest.get(gameId, player).best ?? score);
  return { rank, best };
}

export function topScores(gameId, limit) {
  return topFor.all(gameId, limit).map((row, i) => ({
    rank: i + 1,
    player: row.player,
    score: Number(row.score),
    created: Number(row.created)
  }));
}
