import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import type { EstateClauseClient } from '@/lib/estateClauses/repository'
import { loadEstateClauseSnapshot } from '@/lib/estateClauses/source'
import type {
  EstateClauseManifestEntry,
  EstateClauseSnapshot,
} from '@/lib/estateClauses/types'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  clientSlugFromPayload,
  deriveEstateGeneratorPackages,
  estateGeneratorBlockingError,
  estateGeneratorCoverageWarnings,
  toEstateGeneratorData,
} from '@/lib/estateGenerator/toGeneratorData'
import { loadNodeEstatePackage, resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { compatibleEstateDocumentTypesForTemplate } from '@/lib/estateClauses/templateReferences'
import { dataForNodeEstatePackage, youngAdultEstatePlanData } from '@/lib/estateGenerator/node/packageData'
import { conditionalMissingFieldsForPackage } from '@/lib/estateGenerator/node/packageValidation'
import { renderNodeEstateDocxTemplate } from '@/lib/estateGenerator/node/templateRenderer'
import { resolveDocumentTemplateForBundledPath } from '@/lib/documentTemplates/resolver'
import type { ResolvedDocumentTemplate } from '@/lib/documentTemplates/types'
import type {
  NodeEstateData,
  NodeEstateGeneratedFile,
  NodeEstateGeneratorResult,
  NodeEstatePackageName,
} from '@/lib/estateGenerator/node/types'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import { missingRequiredFields } from '@/lib/estateGenerator/node/validation'

export interface GenerateNodeEstatePackageArgs {
  data: NodeEstateData
  packageName: NodeEstatePackageName
  state: string
  root?: string
  allowDraft?: boolean
  clauseSnapshot?: EstateClauseSnapshot
  templateResolver?: (bundledPath: string) => Promise<ResolvedDocumentTemplate>
}

export interface GenerateEstatePlanDocumentsNodeOptions {
  matterId?: string
  clauseSnapshot?: EstateClauseSnapshot
}

function clauseManifest(
  report: ReturnType<typeof createNodeClauseStore>['report'],
): EstateClauseManifestEntry[] {
  const included = report.included_clauses.map((clause, inclusionPosition) => ({
    clauseId: clause.clause_id,
    clauseKey: clause.clause_key,
    revisionId: clause.revision_id,
    contentHash: clause.content_hash,
    inclusionPosition,
    included: true,
    selectionReason: clause.selection_reason,
    overrideId: clause.override_id,
    overrideAction: clause.override_id ? 'force_include' as const : null,
  }))
  const omitted = report.skipped_clauses.flatMap(clause => (
    clause.override_action && clause.clause_id && clause.clause_key && clause.revision_id && clause.content_hash && clause.override_id
      ? [{
          clauseId: clause.clause_id, clauseKey: clause.clause_key,
          revisionId: clause.revision_id, contentHash: clause.content_hash,
          inclusionPosition: null, included: false, selectionReason: 'attorney_override' as const,
          overrideId: clause.override_id, overrideAction: clause.override_action,
        }]
      : []
  ))
  return [...included, ...omitted]
}

function clientSlug(data: NodeEstateData): string {
  const client = data.client
  const name = typeof client === 'object' && client !== null && !Array.isArray(client)
    ? (client as Record<string, unknown>).full_name
    : null
  return (typeof name === 'string' && name.trim() ? name : 'estate-plan')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
}

const JOINT_PACKAGE_NAMES = new Set<NodeEstatePackageName>(['joint-trust', 'joint-trust-simplified'])

function fullNameOf(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).full_name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return null
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        item != null && typeof item === 'object' && !Array.isArray(item)
      ))
    : []
}

function youngAdultEstatePlanChildren(data: NodeEstateData): Array<Record<string, unknown>> {
  return recordArray(data.children).filter(child => child.young_adult_estate_plan === true)
}

// The person a package's documents belong to. `dataForNodeEstatePackage` has
// already moved the spouse into the `client` slot for `spouse-*` packages, so
// `packageData.client` is always the document owner. Joint trusts belong to
// both spouses and are joined as "Jane Smith & John Smith".
function documentOwnerName(packageData: NodeEstateData, packageName: NodeEstatePackageName): string | null {
  const primary = fullNameOf(packageData.client)
  if (JOINT_PACKAGE_NAMES.has(packageName)) {
    const spouse = fullNameOf(packageData.spouse)
    if (primary && spouse) return `${primary} & ${spouse}`
    return primary ?? spouse
  }
  return primary
}

export async function generateNodeEstatePackage({
  data,
  packageName,
  state,
  root = resolveNodeEstateGeneratorRoot(),
  allowDraft = false,
  clauseSnapshot,
  templateResolver,
}: GenerateNodeEstatePackageArgs): Promise<NodeEstateGeneratorResult> {
  const config = loadNodeEstatePackage(packageName, root)
  const packageData = dataForNodeEstatePackage(data, packageName)
  const context = buildNodeEstateContext({ data: packageData, state, root })
  // Declared required fields that are absent. These do not block generation —
  // the document still renders with a visible `[[ MISSING: field ]]` marker
  // where each empty value would go — but they are reported so the gaps are
  // obvious in the drafting UI.
  const declaredMissing = Array.from(new Set([
    ...missingRequiredFields(context, config.required_fields),
    ...conditionalMissingFieldsForPackage(packageName, context),
  ]))

  const snapshot = clauseSnapshot ?? loadBundledEstateClauseSnapshot({
    root,
    jurisdiction: state,
    allowDraft,
  })
  const owner = documentOwnerName(packageData, packageName)
  const files: NodeEstateGeneratedFile[] = []
  const unresolvedMarkers = new Set<string>()
  const missingFields = new Set<string>(declaredMissing)
  const clauseWarnings = new Set<string>(snapshot.warnings ?? [])

  try {
    for (const document of config.documents) {
      const clauses = createNodeClauseStore({
        root, state, allowDraft, snapshot,
        documentTypes: compatibleEstateDocumentTypesForTemplate(document),
      })
      const absoluteTemplatePath = path.join(root, document.template)
      const bundledPath = path.relative(process.cwd(), absoluteTemplatePath).replaceAll('\\', '/')
      const resolved = templateResolver
        ? await templateResolver(bundledPath)
        : process.env.NODE_ENV === 'test'
          ? null
          : await resolveDocumentTemplateForBundledPath(bundledPath)
      const rendered = renderNodeEstateDocxTemplate({
        templatePath: resolved ? undefined : absoluteTemplatePath,
        templateBuffer: resolved?.buffer,
        context,
        clauses,
      })

      for (const marker of rendered.unresolvedMarkers) unresolvedMarkers.add(marker)
      for (const field of rendered.missingFields) missingFields.add(field)
      for (const field of clauses.report.missing_fields) missingFields.add(field)
      for (const warning of clauses.report.warnings) clauseWarnings.add(warning)
      // Keep this document's own markers alongside the package-level aggregate so
      // a caller can attribute markers to a specific file without re-rendering.
      files.push({
        name: document.output,
        buffer: rendered.buffer,
        title: document.title,
        owner,
        clauseSource: snapshot.source,
        clauseManifest: clauseManifest(clauses.report),
        estateDocumentTypes: compatibleEstateDocumentTypesForTemplate(document),
        templateSha256: resolved?.sha256 ?? createHash('sha256').update(fs.readFileSync(absoluteTemplatePath)).digest('hex'),
        unresolvedMarkers: rendered.unresolvedMarkers,
        missingFields: rendered.missingFields,
        templateId: resolved?.definition.id,
        templateVersionId: resolved?.versionId ?? null,
        templateSource: resolved?.source ?? 'bundled',
      })
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: 500,
      missing: Array.from(missingFields).sort(),
      warnings: Array.from(clauseWarnings),
    }
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: 'Node estate generator completed but did not produce any DOCX files',
      status: 422,
      missing: Array.from(missingFields).sort(),
      warnings: Array.from(clauseWarnings),
    }
  }

  const warnings = Array.from(clauseWarnings)
  if (unresolvedMarkers.size > 0) {
    warnings.push(`Unresolved template markers: ${Array.from(unresolvedMarkers).sort().join(', ')}`)
  }

  return {
    ok: true,
    files,
    missing: Array.from(missingFields).sort(),
    warnings,
    packageName,
    packageNames: [packageName],
    clientSlug: clientSlug(packageData),
  }
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
