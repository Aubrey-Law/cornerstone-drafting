import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config.mjs'
import { ENGAGEMENT_TEMPLATES } from '@/lib/engagement/templates'
import { routesReaching } from './support/routeImportGraph'

/**
 * Production failed on the first render after the masters became a table:
 *
 *   ENOENT: no such file or directory, open
 *   '/var/task/assets/engagement-agreements/ep-lp-trust-couple-v1.docx'
 *
 * The renderer had always read its master from disk, but from a literal
 * `path.join(process.cwd(), 'assets/…/ep-trust-couple-v1.docx')`, which Next's
 * tracer evaluates and follows. Selecting the master from a table made that
 * path a variable the tracer cannot see, so the serverless bundle shipped with
 * no master at all — the new letters and the one that had worked for months
 * alike. Every test passed: under vitest the repository is the filesystem.
 *
 * So this tests the build configuration, and derives the routes that need the
 * masters from the import graph rather than restating a list that goes stale.
 */

const ROOT = path.resolve(__dirname, '..')
const MASTERS = './assets/engagement-agreements/'

/** Modules that reach a bundled master by a path only the config can supply. */
const READS_A_MASTER = ['@/lib/engagement/render', '@/lib/documentTemplates/resolver']

const tracing = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>
const routesRenderingAgreements = routesReaching((_spec, file) => file === 'lib/engagement/render.ts')

describe('engagement master bundling', () => {
  it('finds the routes that render an engagement agreement', () => {
    // Guards the test below: a walker that silently resolved nothing would
    // make it pass over an empty set and prove nothing at all.
    expect(routesRenderingAgreements).toContain('/api/admin/engagement-agreements/[id]/send')
    expect(routesRenderingAgreements).toContain('/api/admin/engagement-agreements/[id]/preview')
  })

  it('traces the masters into every route that renders an agreement', () => {
    const missing = routesRenderingAgreements.filter(
      route => !(tracing[route] ?? []).some(glob => glob.startsWith(MASTERS)),
    )
    expect(
      missing,
      'These routes render an engagement agreement from a bundled master but do '
        + 'not trace the masters into their bundle, so the render will fail with '
        + 'ENOENT in production. Add them to outputFileTracingIncludes in next.config.mjs.',
    ).toEqual([])
  })

  it('traces the masters into the route that serves a bundled master for download', () => {
    // Not a render: Settings reads `definition.bundledPath` itself to hand an
    // attorney the master their override would replace.
    const route = '/api/admin/settings/document-templates/[templateId]/versions/[versionId]/download'
    expect((tracing[route] ?? []).some(glob => glob.startsWith(MASTERS))).toBe(true)
  })

  it('writes every glob relative to the traced root, which is the repository', () => {
    // A glob that resolves against the wrong root matches nothing, and nothing
    // in the build says so — the failure arrives as a runtime ENOENT.
    for (const [route, globs] of Object.entries(tracing)) {
      for (const glob of globs) {
        expect(glob.startsWith('./'), `${route}: ${glob} must be relative to the repository root`).toBe(true)
        expect(existsSync(path.join(ROOT, glob.split('*')[0])), `${route}: ${glob} matches nothing`).toBe(true)
      }
    }
  })

  it('bundles a file for every master the table names', () => {
    // The config traces a directory; this is what has to be in it. A template
    // row pointing at a file nobody added renders nothing but an ENOENT.
    for (const template of ENGAGEMENT_TEMPLATES) {
      expect(template.bundledPath.startsWith(MASTERS.slice(2)), template.masterKey).toBe(true)
      expect(existsSync(path.join(ROOT, template.bundledPath)), `${template.masterKey} has no bundled file`).toBe(true)
    }
  })

  it('keeps the modules that read a master by path in one known place', () => {
    // If a third module starts reading `bundledPath`, the walker above still
    // only knows about these two, and its answer quietly narrows.
    for (const reader of READS_A_MASTER) {
      expect(existsSync(path.join(ROOT, `${reader.slice(2)}.ts`)), reader).toBe(true)
    }
  })
})
