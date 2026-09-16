import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config.mjs'

/**
 * The first native engagement send failed in production with:
 *
 *   The "path" argument must be of type string. Received type number (315754)
 *
 * Nothing in the message names pdf.js, fonts, or a bundler. The cause was
 * `packages/citations/src/textLayer/pdf.ts` resolving pdfjs-dist's package.json
 * to locate its `standard_fonts` directory: bundled, webpack answers that
 * resolve with a numeric module id, and `path.dirname` rejects it.
 *
 * No unit test of that module could have caught it — it runs correctly under
 * vitest, where nothing is bundled. The defect lived entirely in
 * next.config.mjs. So this file tests the build configuration instead, and
 * derives the set of routes that need it from the import graph rather than
 * restating a list that would go stale the next time someone adds a route
 * that locates an anchor.
 */

const ROOT = path.resolve(__dirname, '..')

/** Specifiers that mean "this file will load pdf.js at runtime". */
const PDFJS_SPECIFIERS = ['@aubrey-law/citations/textLayer/pdf', 'pdfjs-dist']

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

const reachesCache = new Map<string, boolean>()

function reachesPdfjs(file: string, visiting = new Set<string>()): boolean {
  const cached = reachesCache.get(file)
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

  let reaches = false
  for (const spec of importSpecifiers(source)) {
    if (PDFJS_SPECIFIERS.includes(spec) || spec.startsWith('pdfjs-dist/')) {
      reaches = true
      break
    }
    const resolved = resolveSpecifier(spec, file)
    if (resolved && reachesPdfjs(resolved, visiting)) {
      reaches = true
      break
    }
  }

  visiting.delete(file)
  reachesCache.set(file, reaches)
  return reaches
}

/** Every `app/api/**\/route.ts`, as the route path Next traces it under. */
function apiRoutes(): { routePath: string; file: string }[] {
  const apiDir = path.join(ROOT, 'app/api')
  return readdirSync(apiDir, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith(`${path.sep}route.ts`) || entry === 'route.ts')
    .map(entry => {
      const file = path.join(apiDir, entry)
      return { routePath: `/api/${path.dirname(entry)}`.replace(/\/\.$/, ''), file }
    })
}

const tracing = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>
const routesNeedingPdfjs = apiRoutes()
  .filter(route => reachesPdfjs(route.file))
  .map(route => route.routePath)
  .sort()

describe('pdf.js bundling', () => {
  it('keeps pdfjs-dist external so its own package resolves to a real path', () => {
    // Bundled, `requireFromHere.resolve('pdfjs-dist/package.json')` in
    // textLayer/pdf.ts returns a module id instead of a filesystem path.
    expect(nextConfig.serverExternalPackages).toContain('pdfjs-dist')
  })

  it('finds the routes that load pdf.js', () => {
    // Guards the two tests below: a resolver that silently resolved nothing
    // would make them pass while proving nothing at all.
    expect(routesNeedingPdfjs).toContain('/api/admin/engagement-agreements/[id]/send')
    expect(routesNeedingPdfjs).toContain('/api/sign/[token]')
  })

  it.each(['pdfjs-dist', '@napi-rs/canvas'])('traces %s into every route that loads pdf.js', pkg => {
    const missing = routesNeedingPdfjs.filter(
      route => !(tracing[route] ?? []).some(glob => glob.includes(pkg)),
    )
    expect(
      missing,
      `These routes read a PDF's text layer but do not trace ${pkg} into their bundle, `
        + 'so it will be missing at runtime. Add them to outputFileTracingIncludes '
        + 'in next.config.mjs.',
    ).toEqual([])
  })
})
