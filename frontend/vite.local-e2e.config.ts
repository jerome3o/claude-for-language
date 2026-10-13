// LOCAL ONLY (never committed): the dev server on its own ports for this worktree.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default defineConfig(async (env) => {
  const resolved = typeof base === 'function' ? await (base as (e: typeof env) => unknown)(env) : base;
  return mergeConfig(resolved as object, {
    server: { port: 3047, strictPort: true, proxy: { '/api': { target: 'http://localhost:8797', changeOrigin: true } } },
  });
});
