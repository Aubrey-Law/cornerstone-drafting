import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Configuration for the live probes — checks that deliberately talk to a real
 * external service, and so can only run where that service is configured.
 *
 * Separate from both other configs on purpose:
 *
 *   - `vitest.config.ts` (unit) replaces the environment with synthetic values,
 *     so real credentials can never leak into the suite. A probe needs the real
 *     ones, so it cannot live there.
 *   - `vitest.integration.config.ts` requires a loopback Supabase and wipes
 *     everything else. A probe needs no database at all, and demanding one would
 *     put back exactly the local-stack prerequisite these are meant to avoid.
 *
 * Probes are named `*.probe.ts` rather than `*.test.ts` so neither of the other
 * two can pick them up by glob.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/probe/**/*.probe.ts'],
    setupFiles: ['tests/probe/setup.ts'],
    // The point of a probe is what it prints — where each anchor actually
    // landed. Vitest's console interception hides that behind the reporter, so
    // it goes straight to stdout instead.
    disableConsoleIntercept: true,
    reporters: ['verbose'],
    // The convert worker is scale-to-zero, so a cold start is part of the
    // wait. Generous rather than flaky.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
