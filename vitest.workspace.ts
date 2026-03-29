import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/contracts/vitest.config.ts',
  'packages/agent/vitest.config.ts',
  'apps/api/vitest.config.ts',
  'apps/extension/vitest.config.ts'
]);
