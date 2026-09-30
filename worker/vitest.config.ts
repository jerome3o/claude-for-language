import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      // Durable Objects in unit tests: the base class only (tests drive a room with fake sockets).
      'cloudflare:workers': path.resolve(__dirname, 'src/__tests__/stubs/cloudflare-workers.ts'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
