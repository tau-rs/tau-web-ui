/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the API root path the UI calls. Default: `/api`. */
  readonly VITE_API_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Minimal `process.env` typing for `vite.config.ts`, which the env-config test
 *  pulls into the program — a single env read doesn't warrant pulling in all of
 *  `@types/node`. */
declare const process: { env: Record<string, string | undefined> };
