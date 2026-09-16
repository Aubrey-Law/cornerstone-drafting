import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The fixture-catalog integration suite.
 *
 * These tests run against the deliberately minimal synthetic schema in
 * tests/integration/fixtures/firm-remediation.sql, applied by hand to a
 * disposable container — not against the real migrations. See
 * tests/integration/fixtures/README.md for the procedure.
 *
 * `include` is the top level only, deliberately. Tests that need the real
 * migrated schema live in tests/integration/schema/ and run under
 * vitest.schema.config.ts, because the two catalogs are incompatible: this
 * fixture stubs public.matters as `(id uuid primary key)` and defines tables
 * (matter_fixture, lead_fixture) that exist in no migration.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/integration/*.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
