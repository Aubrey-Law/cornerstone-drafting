import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/integration/**', '**/node_modules/**', '**/.git/**'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    // Keep the established memory footprint for the drafting/rendering suite.
    // Real-service tests use vitest.integration.config.ts explicitly.
    fileParallelism: false,
  },
})
