import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config.mjs'
import { routesReaching } from './support/routeImportGraph'

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

/** Specifiers that mean "this file will load pdf.js at runtime". */
const PDFJS_SPECIFIERS = ['@aubrey-law/citations/textLayer/pdf', 'pdfjs-dist']

const tracing = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>
const routesNeedingPdfjs = routesReaching(
  spec => PDFJS_SPECIFIERS.includes(spec) || spec.startsWith('pdfjs-dist/'),
)

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
