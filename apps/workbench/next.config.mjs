import path from 'node:path'

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
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@aubrey-law/estate-fields'],
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_TYPE_ERRORS === '1',
  },
}

export default nextConfig
