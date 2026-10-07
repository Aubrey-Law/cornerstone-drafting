import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
      'next/font/local': path.resolve(__dirname, 'tests/stubs/next-font-local.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/integration/**', '**/node_modules/**', '**/.git/**'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    // Real-service tests use vitest.integration.config.ts explicitly.
    //
    // File parallelism was off to hold down the drafting/rendering suite's
    // memory footprint. Measured: serially the whole suite peaks at about
    // 950 MB of node RSS and four-way peaks at about 1.6 GB, so a 16 GB runner
    // was buying a one-file-at-a-time run it had no need to buy.
    //
    // Capped rather than left to the CPU count so the ceiling is a number
    // someone chose and can point at, and so a larger runner does not silently
    // change the footprint. Top-level: Vitest 4 removed `poolOptions`.
    maxWorkers: 4,
  },
})
