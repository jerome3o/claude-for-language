/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Dev server only: the worker origin (e2e/playwright.config.ts on other ports). */
  readonly VITE_API_PROXY?: string;
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
