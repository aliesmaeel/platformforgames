/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public origin of the score service, e.g. https://arcade-api.fly.dev. Empty = same origin. */
  readonly VITE_PFG_API?: string;
}
