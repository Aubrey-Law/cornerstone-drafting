import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    // RLS tests do real network calls to Supabase. Run serially so we don't
    // overwhelm the DB and so per-test seeds don't race.
    fileParallelism: false,
  },
})
