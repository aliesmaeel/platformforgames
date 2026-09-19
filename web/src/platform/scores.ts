import type { ScoreEntry, ScoreResult } from './types';
import { API_BASE } from './endpoints';

/**
 * Leaderboards talk to the score service, and fall back to a per-browser board
 * when it is not running, so games stay playable without a backend.
 */

const LOCAL_KEY = (gameId: string) => `pfg:scores:${gameId}`;
const TIMEOUT_MS = 4000;

type LocalRow = { player: string; score: number; created: number };

function readLocal(gameId: string): LocalRow[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(gameId));
    return raw ? (JSON.parse(raw) as LocalRow[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(gameId: string, rows: LocalRow[]): void {
  try {
    localStorage.setItem(LOCAL_KEY(gameId), JSON.stringify(rows.slice(0, 50)));
  } catch {
    /* storage unavailable: the run simply is not remembered */
  }
}

function rank(rows: LocalRow[]): ScoreEntry[] {
  return [...rows]
    .sort((a, b) => b.score - a.score || a.created - b.created)
    .map((row, i) => ({ rank: i + 1, ...row }));
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export async function topScores(gameId: string, limit = 10): Promise<{ scores: ScoreEntry[]; offline: boolean }> {
  try {
    const res = await request(`${API_BASE}/api/scores/${encodeURIComponent(gameId)}?limit=${limit}`);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { scores: ScoreEntry[] };
    return { scores: body.scores, offline: false };
  } catch {
    return { scores: rank(readLocal(gameId)).slice(0, limit), offline: true };
  }
}

export async function submitScore(gameId: string, player: string, score: number): Promise<ScoreResult> {
  const value = Math.max(0, Math.floor(score));
  try {
    const res = await request(`${API_BASE}/api/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, player, score: value })
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { rank: number; best: number };
    return { rank: body.rank, best: body.best, offline: false };
  } catch {
    const rows = readLocal(gameId);
    rows.push({ player, score: value, created: Date.now() });
    writeLocal(gameId, rank(rows));
    const ranked = rank(rows);
    const mine = ranked.filter((row) => row.player === player);
    return {
      rank: ranked.findIndex((row) => row.score === value) + 1,
      best: Math.max(value, ...mine.map((row) => row.score)),
      offline: true
    };
  }
}
