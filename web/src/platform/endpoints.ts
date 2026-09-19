/**
 * Where the score service and game rooms live. In development Vite proxies
 * /api and /ws to localhost:8787, so same-origin works. For a static deploy
 * (e.g. Vercel) set VITE_PFG_API at build time to the server's public origin,
 * such as https://arcade-api.fly.dev — the API is fetched there and WebSocket
 * rooms use the matching ws(s):// origin.
 */

const configured = (import.meta.env.VITE_PFG_API as string | undefined)?.replace(/\/+$/, '') ?? '';

/** Prefix for fetch() calls: '' for same-origin, or an absolute https origin. */
export const API_BASE = configured;

/** Absolute WebSocket origin for a room path like '/ws/knockabout'. */
export function wsUrl(path: string): string {
  if (configured) return configured.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}
