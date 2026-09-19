# Arcade — a small browser games platform

One shell, many games. The shell owns navigation, the player name and the
leaderboard; each game is a module that mounts into a container and reports a
score when a run ends.

## Run it

```sh
npm install
npm run dev        # score service on :8787 + Vite on :5173
```

Open http://localhost:5173. The score service is optional: if it is not
running, leaderboards fall back to this browser's `localStorage`.

Other scripts: `npm run dev:web`, `npm run dev:server`, `npm run build`
(type-checks then bundles `web/dist`), `npm run preview`.

## Layout

```
server/src/index.js     HTTP score service (Node, no deps)
server/src/db.js        SQLite via node:sqlite  → ./data/scores.db
web/src/platform/       the shell
  types.ts              GameModule / GameContext contract
  registry.ts           catalog: title, blurb, tags, lazy loader
  shell.ts              routing (#/ and #/play/<id>), mount/unmount, leaderboard panel
  scores.ts             API client with localStorage fallback
  player.ts             persisted player name
web/src/games/<id>/     one folder per game, default-exports a GameModule
```

## Adding a game

1. Create `web/src/games/<id>/index.ts` that default-exports a `GameModule`:

   ```ts
   import type { GameModule } from '../../platform/types';

   const game: GameModule = {
     mount(container, ctx) {
       // draw into `container`; call ctx.submitScore(n) when a run ends;
       // ctx.exit() returns to the catalog; ctx.setStatus('…') writes to the HUD.
       return { destroy() { /* release canvases, listeners, timers */ } };
     }
   };
   export default game;
   ```

2. Give its entry in `registry.ts` a `load: () => import('../games/<id>/index')`.
   The card flips from "in the works" to a Play button; the leaderboard is keyed by `id`.

The game folder can use any engine. `endless-runner` uses Phaser 3 (lazy-loaded,
so the catalog page stays small); 3D games are expected to use Three.js.

## Score API

```
GET  /api/health
GET  /api/scores/:gameId?limit=10   → { gameId, scores: [{ rank, player, score, created }] }
POST /api/scores  { gameId, player, score }  → { rank, best, ... }
```

`gameId` is `[a-z0-9-]{1,40}`; player names are trimmed to 24 chars; scores are
non-negative integers. Nothing is authenticated yet — treat the board as
"honor system" until accounts exist.

## Roadmap

See the catalog on the home page. Build order: Dash (done) → Gemline (match-3)
→ Tiltway (3D ball maze) → the rest, so the shell hardens on simple games first.
