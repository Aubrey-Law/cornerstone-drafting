import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Which API routes can reach a given module at runtime.
 *
 * Next traces a serverless bundle by following imports, so anything a route
 * reaches by path rather than by import is invisible to it: the route builds
 * clean, deploys, and fails on the first request. The tests that guard
 * `outputFileTracingIncludes` therefore need the set of routes that reach the
 * module doing the reading — derived from the import graph, because a list
 * restated in a test goes stale the next time someone adds a route.
 */

const ROOT = path.resolve(__dirname, '../..')

export interface ApiRoute {
  /** The route path Next traces the bundle under, e.g. `/api/sign/[token]`. */
  routePath: string
  file: string
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('@aubrey-law/citations/')) {
    base = path.join(ROOT, 'packages/citations/src', spec.slice('@aubrey-law/citations/'.length))
  } else return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return existsSync(base) ? base : null
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]/g),
  ].map(match => match[1])
}

/** Every `app/api/**\/route.ts`, as the route path Next traces it under. */
export function apiRoutes(): ApiRoute[] {
  const apiDir = path.join(ROOT, 'app/api')
  return readdirSync(apiDir, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith(`${path.sep}route.ts`) || entry === 'route.ts')
    .map(entry => {
      const file = path.join(apiDir, entry)
      return { routePath: `/api/${path.dirname(entry)}`.replace(/\/\.$/, ''), file }
    })
}

/**
 * The route paths whose import graph reaches a target, sorted.
 *
 * `isTarget` is asked about every import a reachable file makes: the specifier
 * as written, and the repository-relative file it resolves to, or null for a
 * package. Match on the resolved file for a module of this repository — the
 * same module is imported as `@/lib/x` from a route and as `./x` from its
 * neighbour, and matching the text would miss one of them.
 */
export function routesReaching(
  isTarget: (specifier: string, resolvedFile: string | null) => boolean,
): string[] {
  const cache = new Map<string, boolean>()

  function reaches(file: string, visiting = new Set<string>()): boolean {
    const cached = cache.get(file)
    if (cached !== undefined) return cached
    // A cycle cannot introduce a new dependency, so unwinding as false is safe
    // and is not cached — a later path to the same file must still be walked.
    if (visiting.has(file)) return false
    visiting.add(file)

    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      return false
    }

    let found = false
    for (const spec of importSpecifiers(source)) {
      const resolved = resolveSpecifier(spec, file)
      if (isTarget(spec, resolved && path.relative(ROOT, resolved))) {
        found = true
        break
      }
      if (resolved && reaches(resolved, visiting)) {
        found = true
        break
      }
    }

    visiting.delete(file)
    cache.set(file, found)
    return found
  }

  return apiRoutes()
    .filter(route => reaches(route.file))
    .map(route => route.routePath)
    .sort()
}
