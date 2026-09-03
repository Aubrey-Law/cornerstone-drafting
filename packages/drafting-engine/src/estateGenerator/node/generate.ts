import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { loadBundledEstateClauseSnapshot } from '../../estateClauses/fileRepository'
import type { EstateClauseManifestEntry, EstateClauseSnapshot } from '../../estateClauses/types'
import { compatibleEstateDocumentTypesForTemplate } from '../../estateClauses/templateReferences'
import { loadNodeEstatePackage, resolveNodeEstateGeneratorRoot } from './config'
import { buildNodeEstateContext } from './context'
import { createNodeClauseStore } from './clauses'
import { dataForNodeEstatePackage } from './packageData'
import { conditionalMissingFieldsForPackage } from './packageValidation'
import { renderNodeEstateDocxTemplate } from './templateRenderer'
import { missingRequiredFields } from './validation'
import type { ResolvedDocumentTemplate } from '../../documentTemplates/types'
import type {
  NodeEstateData,
  NodeEstateGeneratedFile,
  NodeEstateGeneratorResult,
  NodeEstatePackageName,
} from './types'
import type { StyleSetSettings } from '../../styleSets/schema'

/**
 * Renders one estate package to DOCX. Pure: every source of bytes, formatting
 * and clause text is passed in, so this runs with no database, no storage and
 * no framework.
 *
 * The matter-shaped entry point that turns a DraftPayload into these arguments
 * stays in the application, where the DraftPayload lives.
 */

/** Forces the bundled template, ignoring any published override. */
export const bundledTemplateResolver = async (): Promise<ResolvedDocumentTemplate | null> => null

export interface GenerateNodeEstatePackageArgs {
  data: NodeEstateData
  packageName: NodeEstatePackageName
  state: string
  root?: string
  allowDraft?: boolean
  clauseSnapshot?: EstateClauseSnapshot
  /**
   * Where a template's bytes come from. Return null for the bundled template;
   * `bundledTemplateResolver` does exactly that.
   *
   * Required on purpose. This used to default to the database-backed resolver
   * outside tests, which meant production and the test suite rendered from
   * different sources and a caller that forgot it silently lost published
   * template overrides. Naming it at every call site makes that a compile
   * error instead of a client document quietly built from the wrong template.
   */
  templateResolver: (bundledPath: string) => Promise<ResolvedDocumentTemplate | null>
  /** Formatting applied to every document in the package. Required, for the same reason. */
  styleSet: StyleSetSettings
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

export function youngAdultEstatePlanChildren(data: NodeEstateData): Array<Record<string, unknown>> {
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
  styleSet,
}: GenerateNodeEstatePackageArgs): Promise<NodeEstateGeneratorResult> {
  // Resolved once per package by the caller, not once per document: every
  // document in a package shares the firm's formatting, and re-reading it per
  // file would multiply the query by the eight or so documents a trust
  // package renders.
  const formatting = styleSet

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
      const resolved = await templateResolver(bundledPath)
      const rendered = renderNodeEstateDocxTemplate({
        templatePath: resolved ? undefined : absoluteTemplatePath,
        templateBuffer: resolved?.buffer,
        context,
        clauses,
        styleSet: formatting,
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
