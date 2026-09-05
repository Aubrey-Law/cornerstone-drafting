import path from 'node:path'
import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'
import { assertDeployEnv } from './lib/env'

// A deploy build with a missing variable fails here, with every missing name,
// while the previous deployment keeps serving. Locally this only warns.
assertDeployEnv(process.env)

/**
 * The Sentry build plugin creates a release and uploads source maps, both of
 * which need an authenticated token. Running it without one produces only
 * misleading release warnings, so it is gated on the credential rather than on
 * an environment name.
 */
const SENTRY_BUILD_PLUGIN_ENABLED = Boolean(process.env.SENTRY_AUTH_TOKEN)

/**
 * The workbench builds from apps/workbench, not the repository root, so two
 * settings differ from the root app and both are load-bearing:
 *
 *  - outputFileTracingRoot must reach the monorepo root, or Next cannot trace
 *    the workspace packages symlinked into the shared node_modules.
 *  - the estate data corpus is resolved by package (@aubrey-law/estate-templates)
 *    rather than from process.cwd(), so no tracing include is needed for it
 *    until a route actually reads it.
 *
 * Every package listed in transpilePackages is also declared in package.json;
 * tests/build-config.test.ts holds the two in step, because a package that is
 * transpiled but undeclared resolves on a developer machine and not on Vercel.
 */
export const workbenchConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  /**
   * `@napi-rs/canvas` is a native binding, which cannot be placed in an ESM
   * chunk at all — the build fails outright rather than degrading. pdf.js
   * reaches for it to measure glyphs server-side.
   *
   * Only that one. Listing `pdfjs-dist` here made the build warn that the
   * package "can't be external": the viewer imports its worker as ESM
   * (`pdf.worker.min.mjs`), which cannot then be reached by `require()`.
   */
  serverExternalPackages: ['@napi-rs/canvas'],
  /**
   * Files reached at runtime by path rather than by import, which tracing
   * cannot infer. pdf.js resolves its own standard fonts and its native canvas
   * binding this way.
   *
   * These globs resolve against the **project directory**, not
   * `outputFileTracingRoot` — which is why `./node_modules/...` works here and
   * a path written from the repository root would match nothing, silently. The
   * review playbook used to be listed here and never was traced; it is a module
   * import now, which cannot fail that way. Prefer an import to an entry here.
   */
  outputFileTracingIncludes: {
    '/api/staff/review': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
    ],
  },
  transpilePackages: [
    '@aubrey-law/estate-fields',
    '@aubrey-law/drafting-engine',
    '@aubrey-law/ui',
    '@aubrey-law/citations',
  ],
}

export default SENTRY_BUILD_PLUGIN_ENABLED
  ? withSentryConfig(workbenchConfig, {
      org: 'aubrey-law',
      // The Workbench reports into its own project, so a spike here is not read
      // as a regression in the app the firm runs today.
      project: process.env.SENTRY_PROJECT ?? 'workbench',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      widenClientFileUpload: false,
    })
  : workbenchConfig
