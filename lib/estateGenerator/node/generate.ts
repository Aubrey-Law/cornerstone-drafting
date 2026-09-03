import {
  bundledTemplateResolver,
  generateNodeEstatePackage,
  youngAdultEstatePlanChildren,
} from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import type { GenerateNodeEstatePackageArgs } from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import type { EstateClauseClient } from '@/lib/estateClauses/repository'
import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import { loadEstateClauseSnapshot } from '@/lib/estateClauses/source'
import type { EstateClauseSnapshot } from '@/lib/estateClauses/types'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  clientSlugFromPayload,
  deriveEstateGeneratorPackages,
  estateGeneratorBlockingError,
  estateGeneratorCoverageWarnings,
  toEstateGeneratorData,
} from '@/lib/estateGenerator/toGeneratorData'
import { youngAdultEstatePlanData } from '@/lib/estateGenerator/node/packageData'
import { generatorInjections } from '@/lib/estateGenerator/generatorInjections'
import type {
  NodeEstateData,
  NodeEstateGeneratedFile,
  NodeEstateGeneratorResult,
  NodeEstatePackageName,
} from '@/lib/estateGenerator/node/types'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'

// The renderer moved to @aubrey-law/drafting-engine during Phase 1 of the
// Workbench overhaul. Re-exported so the ~30 call sites keep resolving.
export {
  bundledTemplateResolver,
  generateNodeEstatePackage,
  youngAdultEstatePlanChildren,
}
export type { GenerateNodeEstatePackageArgs }

// What stays here: the matter-shaped entry point. It turns a DraftPayload into
// generator data and supplies the two things the pure renderer will not source
// for itself — the database-backed template resolver and the firm's style set.

export interface GenerateEstatePlanDocumentsNodeOptions {
  matterId?: string
  clauseSnapshot?: EstateClauseSnapshot
}

export async function generateEstatePlanDocumentsNode(
  payload: DraftPayload,
  options: GenerateEstatePlanDocumentsNodeOptions = {},
): Promise<NodeEstateGeneratorResult> {
  const packageNames = deriveEstateGeneratorPackages(payload) as NodeEstatePackageName[]
  const unsupported = packageNames.filter(packageName => !isNodeEstatePackageSupported(packageName))
  const coverageWarnings = estateGeneratorCoverageWarnings(payload)
  const blockingError = estateGeneratorBlockingError(payload)

  if (packageNames.length === 0) {
    return {
      ok: false,
      error: coverageWarnings[0] ?? 'No supported estate generator packages were selected for this matter.',
      status: 422,
      warnings: coverageWarnings,
    }
  }

  if (blockingError) {
    return {
      ok: false,
      error: blockingError,
      status: 422,
      warnings: coverageWarnings,
    }
  }

  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `Node estate generator does not support selected package(s) yet: ${packageNames.join(', ')}.`,
      status: 501,
      warnings: coverageWarnings,
    }
  }

  const data = toEstateGeneratorData(payload) as unknown as NodeEstateData
  const state = normalizeJurisdictionStateCode(payload.client.state)
  const clauseSnapshot = options.clauseSnapshot ?? (options.matterId
    ? await loadEstateClauseSnapshot({
        matterId: options.matterId,
        jurisdiction: state,
        client: getAdminClient() as unknown as EstateClauseClient,
        allowDraft: true,
      })
    : loadBundledEstateClauseSnapshot({
        jurisdiction: state,
        allowDraft: true,
      }))
  const files: NodeEstateGeneratedFile[] = []
  const missing: string[] = []
  const warnings: string[] = [...coverageWarnings]

  // Resolved once per matter rather than once per package: every document
  // shares the firm's formatting and template source.
  const injections = await generatorInjections()

  for (const packageName of packageNames) {
    if (packageName === 'young-adult-estate-plan') {
      const children = youngAdultEstatePlanChildren(data)
      if (children.length === 0) {
        warnings.push('Young Adult Estate Plan selected, but no child with a DOB from age 17.5 through 25 was found.')
        continue
      }

      for (const child of children) {
        const result = await generateNodeEstatePackage({
          data: youngAdultEstatePlanData(data, child),
          packageName,
          state,
          allowDraft: true,
          clauseSnapshot,
          ...injections,
        })

        if (!result.ok) return result
        files.push(...result.files)
        missing.push(...result.missing)
        warnings.push(...result.warnings)
      }
    } else {
      const result = await generateNodeEstatePackage({
        data,
        packageName,
        state,
        allowDraft: true,
        clauseSnapshot,
        ...injections,
      })

      if (!result.ok) return result
      files.push(...result.files)
      missing.push(...result.missing)
      warnings.push(...result.warnings)
    }
  }

  return {
    ok: true,
    files,
    missing,
    warnings,
    packageName: packageNames[0],
    packageNames,
    clientSlug: clientSlugFromPayload(payload),
  }
}
