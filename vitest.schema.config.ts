import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Tests that need the real migrated schema.
 *
 * These run against a database built by `supabase start`, which applies
 * supabase/migrations itself — so constraints, foreign keys and generated
 * columns are the real ones. That is the whole point: the defect in #494 wrote
 * an invented uuid into a column with `references engagement_agreements(id)`,
 * which no mock and no stub catalog can reject.
 *
 * Kept separate from vitest.integration.config.ts, which drives the same
 * directory's fixture-catalog suite against an incompatible synthetic schema.
 * .github/workflows/integration-schema.yml runs this config in CI.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/integration/schema/**/*.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
