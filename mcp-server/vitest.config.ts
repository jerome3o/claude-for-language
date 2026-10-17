import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The oauth provider imports `cloudflare:workers` (WorkerEntrypoint), which
    // only exists in workerd; the OAuth flow tests run it in Node.
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./src/oauth/__tests__/cloudflare-workers-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/ui/**', 'node_modules/**'],
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
