import { describe, expect, it } from 'vitest'
import { workbenchConfig } from '../next.config'

/**
 * Files this app reaches at runtime by path rather than by import.
 *
 * Next traces a serverless bundle by following imports, so anything resolved by
 * path is invisible to it: the route builds clean, deploys, and fails on the
 * first request.
 *
 * The lesson from getting this wrong: asserting a path appears in this config
 * proves nothing. The review playbook was listed here and never actually
 * traced, because these globs resolve against the project directory rather than
 * `outputFileTracingRoot`, so a path written from the repository root matched
 * nothing and no build step complained. The playbook is a module import now,
 * and `review-playbook.test.ts` asserts the filesystem is never touched — a
 * claim a mistake cannot satisfy.
 *
 * What is left here is genuinely path-resolved: pdf.js reaches for its own
 * standard fonts and its native canvas binding at runtime, and both are
 * confirmed present in the built trace.
 */
describe('runtime asset tracing', () => {
  const includes = workbenchConfig.outputFileTracingIncludes ?? {}

  it('traces the native canvas binding pdf.js needs for glyph measurement', () => {
    expect(includes['/api/staff/review']?.some((g) => g.includes('@napi-rs/canvas'))).toBe(true)
  })

  it('traces pdfjs itself, which resolves its standard fonts by path', () => {
    expect(includes['/api/staff/review']?.some((g) => g.includes('pdfjs-dist'))).toBe(true)
  })

  it('keeps the native binding out of the bundler, which cannot place it', () => {
    expect(workbenchConfig.serverExternalPackages).toContain('@napi-rs/canvas')
  })

  it('writes every glob relative to the project directory', () => {
    // The trap that cost a production error: a glob starting at the repository
    // root silently matches nothing.
    for (const globs of Object.values(includes)) {
      for (const glob of globs as string[]) {
        expect(glob.startsWith('./node_modules/'), `${glob} must be relative to apps/workbench`).toBe(true)
      }
    }
  })
})
