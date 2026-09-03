import { bundledTemplateResolver } from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import type { GenerateNodeEstatePackageArgs } from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import { DEFAULT_STYLE_SET } from '@aubrey-law/drafting-engine/styleSets/defaults'
import { resolveDocumentTemplateForBundledPath } from '@/lib/documentTemplates/resolver'
import { resolveStyleSet } from '@/lib/styleSets/data'

export type GeneratorInjections = Pick<GenerateNodeEstatePackageArgs, 'templateResolver' | 'styleSet'>

/**
 * Where the pure renderer gets its templates and formatting.
 *
 * `generateNodeEstatePackage` takes both as required arguments so it can live in
 * @aubrey-law/drafting-engine with no database. That leaves one decision — which
 * sources to hand it — and this is the single place that makes it, so no call
 * site can quietly pick the wrong one.
 *
 * Under test we render from bundled templates with the built-in sweep, because
 * the suite runs with no database and no secrets. Everywhere else the
 * attorney's published template overrides and the firm's style set apply. That
 * branch used to sit inside the renderer itself, which meant the engine behaved
 * differently under test; it belongs here, in the application, instead.
 */
export async function generatorInjections(): Promise<GeneratorInjections> {
  if (process.env.NODE_ENV === 'test') {
    return { templateResolver: bundledTemplateResolver, styleSet: DEFAULT_STYLE_SET }
  }
  return {
    templateResolver: resolveDocumentTemplateForBundledPath,
    styleSet: await resolveStyleSet(),
  }
}
