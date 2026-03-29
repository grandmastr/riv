import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@riv/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url)
      ),
      '@riv/agent': fileURLToPath(
        new URL('../../packages/agent/src/index.ts', import.meta.url)
      )
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
