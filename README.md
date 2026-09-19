# Arcade — a small browser games platform

One shell, eleven games. The shell owns navigation, the player name and the
leaderboard; each game is a module that mounts into a container and reports a
score when a run ends.

## Run it

```sh
npm install
npm run dev        # score service + Knockabout room on :8787, Vite on :5173
```

Open http://localhost:5173. The score service is optional for nine of the
games: if it is not running, leaderboards fall back to this browser's
`localStorage`. Knockabout (multiplayer) needs it.

| Script            | What it does                                                      |
| ----------------- | ----------------------------------------------------------------- |
| `npm run dev`     | both servers, with reload                                         |
| `npm test`        | unit tests for the pure game logic and the arena sim (Node only)  |
| `npm run e2e`     | headless-Chrome run through every game against isolated servers   |
| `npm run build`   | type-check, then bundle `web/dist`                                |
| `npm run preview` | serve the production bundle                                       |

`npm run e2e` needs Chrome (`CHROME_PATH`, default `/usr/bin/google-chrome`).
It disables WebGL so the suite is deterministic on machines without a GPU;
`PFG_WEBGL=1 npm run e2e` renders through SwiftShader instead and the tests
leave screenshots at `e2e/.last-*.png`. `npm run e2e ridgeline` runs one file.

## The games

| Game        | Folder                     | Kind | Engine   | Notes                                                           |
| ----------- | -------------------------- | ---- | -------- | --------------------------------------------------------------- |
| Dash        | `games/endless-runner`     | 2D   | Phaser   | auto-runner; jump crates, slide under beams, speed ramps        |
| Gemline     | `games/match-three`        | 2D   | Phaser   | swap-to-match; 8 data-driven levels with colour goals           |
| Shoot-ha    | `games/shoot-ha`           | 2D   | Canvas   | flick-football; chess clocks; vs computer, one device, or online |
| Stackfall   | `games/block-drop`         | 2D   | Phaser   | falling blocks; hold, ghost, 7-bag, lock delay                  |
| Overrun     | `games/arena-shooter`      | 2D   | Phaser   | WASD + mouse waves; pick an upgrade between waves               |
| Holdfast    | `games/tower-defense`      | 2D   | Phaser   | maze-style TD with a BFS flow field; 20 waves                   |
| Tiltway     | `games/ball-maze`          | 3D   | Three.js | tilt the board; 5 ASCII-defined mazes; falls cost time          |
| Ridgeline   | `games/low-poly-racer`     | 3D   | Three.js | 3-lap time trial; best-lap ghost persists in localStorage       |
| Skyline     | `games/stack-tower`        | 3D   | Three.js | drop sliding slabs; overhang is sliced; perfects regrow         |
| Leapfall    | `games/platformer-3d`      | 3D   | Three.js | 3 courses; coyote time, jump buffer, moving platforms, coins    |
| Knockabout  | `games/party-arena`        | 3D   | Three.js | 4-player shove-off on a shrinking disc; server-authoritative    |

Every game keeps its rules in a pure module next to the renderer
(`board.ts`, `well.ts`, `field.ts`, `rules.ts`, `maze.ts`, `track.ts`,
`stack.ts`, `physics.ts`, `server/src/arena.js`, `server/src/shootha.js`) with a Node unit test beside it. Levels
and waves are plain data (`levels.ts`, `waveSpec`), so content ships without
engine code.

## Layout

```
server/src/index.js     HTTP score service (Node, no framework)
server/src/db.js        SQLite via node:sqlite  → ./data/scores.db
server/src/arena.js     Knockabout simulation (pure, tick-driven)
server/src/knockabout.js  WebSocket room at /ws/knockabout, 20 Hz snapshots
web/src/platform/       the shell
  types.ts              GameModule / GameContext / GameMeta contract
  registry.ts           catalog: title, blurb, tags, lazy loader, score format
  shell.ts              routing (#/ and #/play/<id>), mount/unmount, leaderboard panel
  scores.ts             API client with localStorage fallback
  player.ts             persisted player name
web/src/games/_shared/  helpers: phaser.ts (mount, overlay), three.ts (app, lights),
                        hud.ts (DOM readouts/panel for 3D), audio.ts (synth blips)
web/src/games/<id>/     one folder per game, default-exports a GameModule
e2e/                    run.mjs boots isolated servers; one *.test.mjs per game
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

   For Phaser, `mountPhaser(container, ctx, key, Scene, { width, height })`
   in `_shared/phaser.ts` handles boot/teardown and gives you `Overlay` and
   `finishRun`. For Three.js, `createThreeApp` + `createHud` +
   `finishRunHud` do the same.

2. Give its entry in `registry.ts` a `load: () => import('../games/<id>/index')`.
   The card flips from "in the works" to a Play button; the leaderboard is
   keyed by `id`. Add `formatScore` if the number is not a plain score
   (Ridgeline stores `600000 − lapMs` so the shared high-to-low sort ranks
   the fastest lap first, and formats it back to `m:ss.ss`).

3. Put the rules in a pure module with a `*.test.ts` beside it (imports need
   the `.ts` extension so Node can run them), and add an `e2e/<name>.test.mjs`
   that drives the real game through `window.__pfg` (a DEV-only hook the
   mount helpers expose).

## Score API

```
GET  /api/health
GET  /api/scores/:gameId?limit=10   → { gameId, scores: [{ rank, player, score, created }] }
POST /api/scores  { gameId, player, score }  → { rank, best, ... }
WS   /ws/knockabout                 client sends {type:'join',name} then {type:'input',dx,dz,dash};
                                    server sends {type:'welcome'}, {type:'state',…} at 20 Hz, {type:'results'}
WS   /ws/shoot-ha                   {type:'host',name} → {type:'hosted',code}; {type:'join',code,name} →
                                    {type:'start',side,names,first} to both; then {type:'relay',payload}
                                    with payload.kind ∈ shot | timeout | rematch is forwarded to the other side
```

Shoot-ha online is lockstep rather than server-simulated: both browsers run the
same physics (written with only exact IEEE operations — no `Math.hypot`/`pow`
— so engines agree bit for bit), and every shot carries the shooter's
positions, score and clocks, which the other side adopts before replaying it.
The server just pairs two players by a 4-letter code and forwards messages.
`server/src/shootha.test.js` exercises the room; `e2e/shootha-online.test.mjs`
plays a full match across two browser contexts.

`gameId` is `[a-z0-9-]{1,40}`; player names are trimmed to 24 chars; scores are
non-negative integers. Nothing is authenticated yet — treat the boards as
"honor system" until accounts exist. `PFG_ROUND_S` shortens Knockabout rounds
(the e2e runner sets it to 8).

## Deploying

The web app is static; the score service and game rooms are one long-running
Node process. They deploy separately.

### Web on Vercel (auto-deploys from Git)

`vercel.json` is already set up (build `npm run build`, output `web/dist`).

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In Vercel: **Add New → Project → Import** the repo. Leave the detected
   settings — they come from `vercel.json`.
3. Under **Environment Variables** add `VITE_PFG_API` = the public origin of
   your server (step below), e.g. `https://arcade-api.fly.dev`. Skip it for
   now if you have no server yet: every game still runs, leaderboards fall
   back to this-browser-only, and the online modes say the server is missing.
4. Deploy. From then on every push to the default branch deploys to
   production and every other branch/PR gets a preview URL.

`VITE_PFG_API` is read at build time (see `web/src/platform/endpoints.ts`),
so changing it means redeploying. The service already sends permissive CORS
headers, and WebSockets connect to the same origin over `wss://`.

### Server anywhere that runs a container

Vercel functions cannot hold WebSockets or a writable SQLite file, so the
service lives elsewhere. `server/Dockerfile` builds it; it listens on `PORT`
(8787) and writes `PFG_DB` (`/data/scores.db`), so mount a volume at `/data`.

Fly.io, as one example, with `server/fly.toml` included:

```sh
cd server
fly launch --no-deploy        # accept the app name or edit fly.toml
fly volumes create pfg_data --size 1
fly deploy
```

Railway, Render, a VPS with Docker, etc. all work the same way: build the
Dockerfile, attach persistent storage at `/data`, expose port 8787 behind
HTTPS, then put that origin in Vercel's `VITE_PFG_API`.

### Checks on push

`.github/workflows/ci.yml` runs `npm test` and the production build on every
push and pull request, so a red build shows up on the PR before Vercel's
preview does.
