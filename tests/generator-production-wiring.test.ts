import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/**
 * `generateNodeEstatePackage` used to default its template resolver and style
 * set to the database-backed ones outside tests. Phase 1 of the Workbench
 * overhaul made both required so the pure engine could move into
 * @aubrey-law/drafting-engine, which means every caller now names its own
 * source of templates and formatting.
 *
 * The risk that creates is specific: a production call site that passes the
 * bundled resolver instead of the database one still renders, still passes
 * every test, and still produces a plausible document — built from the wrong
 * template, ignoring any published override the attorney has staged.
 *
 * The render baseline cannot catch this. It runs under NODE_ENV=test, where
 * both paths already resolve to the bundled template, so byte-identical output
 * proves the refactor and says nothing about the wiring. These assertions are
 * the gate for that, and they are deliberately about the production call sites
 * only.
 */
describe('generator production wiring', () => {
  const HELPER = 'lib/estateGenerator/generatorInjections.ts'

  it('routes every caller through one place that decides the sources', () => {
    // Two production call sites render estate documents. Both must spread the
    // shared helper rather than choosing for themselves.
    for (const caller of [
      'lib/estateGenerator/node/generate.ts',
      'app/api/admin/matters/[id]/design-sheet/export/route.ts',
    ]) {
      const source = read(caller)
      expect(source).toContain('generatorInjections')
      expect(
        source,
        `${caller} names a resolver directly instead of using ${HELPER}`,
      ).not.toMatch(/templateResolver:\s*(bundledTemplateResolver|resolveDocumentTemplateForBundledPath)/)
    }
  })

  it('resolves published templates and the firm style set outside test', () => {
    const helper = read(HELPER)
    // The production branch is the last return in the helper; the first is the
    // test branch guarded by NODE_ENV.
    const production = helper.slice(helper.lastIndexOf('return {'))
    expect(production).toContain('resolveDocumentTemplateForBundledPath')
    expect(production).toContain('resolveStyleSet')
    // The bundled resolver must not leak into the production branch: it would
    // ignore every published override the attorney has staged.
    expect(production).not.toContain('bundledTemplateResolver')
  })

  it('renders from bundled templates under test, where there is no database', () => {
    const helper = read(HELPER)
    const testBranch = helper.slice(helper.indexOf('NODE_ENV'), helper.lastIndexOf('return {'))
    expect(testBranch).toContain('bundledTemplateResolver')
    expect(testBranch).toContain('DEFAULT_STYLE_SET')
  })

  it('leaves no environment branch inside the engine', () => {
    // This branch is why production and the test suite used to render from
    // different sources. It now lives only in the app adapter above.
    expect(read('packages/drafting-engine/src/estateGenerator/node/generate.ts')).not.toContain('NODE_ENV')
  })
})
