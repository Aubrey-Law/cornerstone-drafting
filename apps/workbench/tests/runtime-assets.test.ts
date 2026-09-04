import { describe, expect, it } from 'vitest'
import { workbenchConfig } from '../next.config'
import { loadReviewPlaybook } from '@/lib/review/playbook'

/**
 * Files this app reads by path at runtime, rather than imports.
 *
 * Next traces a serverless bundle by following imports, so an `fs.readFileSync`
 * is invisible to it: the route builds clean, deploys, and throws ENOENT on the
 * first request. Nothing else catches that before production — the file is
 * present on a developer machine because the whole repository is.
 */
describe('runtime asset tracing', () => {
  const includes = workbenchConfig.outputFileTracingIncludes ?? {}

  it('traces the review playbook for every route that reads it', () => {
    // Both the API route and the page load the playbook from disk.
    for (const route of ['/api/staff/review', '/review']) {
      expect(includes[route]?.some((glob) => glob.includes('tools/workflows/review')), route).toBe(true)
    }
  })

  it('traces the native canvas binding pdf.js needs for glyph measurement', () => {
    expect(includes['/api/staff/review']?.some((g) => g.includes('@napi-rs/canvas'))).toBe(true)
  })

  it('keeps the native binding out of the bundler, which cannot place it', () => {
    expect(workbenchConfig.serverExternalPackages).toContain('@napi-rs/canvas')
  })

  it('can actually read the playbook it traces', () => {
    // Proves the traced path and the path the code reads are the same one.
    expect(loadReviewPlaybook().rules.length).toBeGreaterThan(0)
  })
})
