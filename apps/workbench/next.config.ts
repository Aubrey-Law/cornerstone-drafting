import path from 'node:path'
import type { NextConfig } from 'next'
import { assertDeployEnv } from './lib/env'

// A deploy build with a missing variable fails here, with every missing name,
// while the previous deployment keeps serving. Locally this only warns.
assertDeployEnv(process.env)

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
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@aubrey-law/estate-fields', '@aubrey-law/drafting-engine', '@aubrey-law/ui'],
}

export default nextConfig
