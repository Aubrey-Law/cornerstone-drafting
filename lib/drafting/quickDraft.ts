import fs from 'node:fs'
import path from 'node:path'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import { resolveNodeEstateGeneratorRoot, loadNodeEstatePackage } from '@/lib/estateGenerator/node/config'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { dataForNodeEstatePackage } from '@/lib/estateGenerator/node/packageData'
import { renderNodeEstateDocxTemplate } from '@/lib/estateGenerator/node/templateRenderer'
import type { NodeEstateData, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'
import { getDocumentTemplateDefinition } from '@/lib/documentTemplates/registry'
import {
  customTemplateRowId,
  getCustomTemplate,
  resolveCustomTemplateBuffer,
} from '@/lib/documentTemplates/customTemplates'
import type { DocumentTemplateDefinition } from '@/lib/documentTemplates/types'

// ── Field overrides ───────────────────────────────────────────────────────────

/**
 * Data roots a quick-draft override may write into. Everything else in the
 * render context is derived (computed booleans, state rules) and must not be
 * set directly.
 */
const OVERRIDABLE_ROOTS = new Set([
  'client',
  'spouse',
  'marriage',
  'children',
  'family',
  'trust',
  'will',
  'pour_over',
  'outright_will',
  'testamentary_trust',
  'dpoa',
  'healthcare',
  'hipaa',
  'execution',
  'fiduciaries',
  'fiduciary_display',
  'guardians',
  'assets',
  'funding_plan',
  'homestead',
  'tax',
  'planning',
  'extras',
])

const SAFE_SEGMENT = /^[a-zA-Z0-9_]+$/
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function isOverridablePath(rawPath: string): boolean {
  const segments = rawPath.split('.')
  if (segments.length === 0 || !segments.every(segment => SAFE_SEGMENT.test(segment))) return false
  if (segments.some(segment => FORBIDDEN_SEGMENTS.has(segment))) return false
  return OVERRIDABLE_ROOTS.has(segments[0])
}

/**
 * Set dot-path string values onto the package data before the context build,
 * e.g. `{ 'trust.name': 'The Smith Family Trust' }`. Numeric segments index
 * into arrays (`children.0.full_name`). Unknown/unsafe paths throw so the
 * caller can surface them instead of silently dropping the attorney's answer.
 */
export function applyFieldOverrides(
  data: NodeEstateData,
  overrides: Record<string, string>,
): NodeEstateData {
  const result = { ...data }
  for (const [rawPath, value] of Object.entries(overrides)) {
    if (!isOverridablePath(rawPath)) {
      throw new Error(`Field path is not overridable: ${rawPath}`)
    }
    const segments = rawPath.split('.')
    let cursor: Record<string, unknown> | unknown[] = result
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      const nextIsIndex = /^\d+$/.test(segments[i + 1])
      const existing: unknown = Array.isArray(cursor)
        ? cursor[Number(segment)]
        : (cursor as Record<string, unknown>)[segment]
      let next: Record<string, unknown> | unknown[]
      if (Array.isArray(existing)) {
        next = [...existing]
      } else if (existing && typeof existing === 'object') {
        next = { ...(existing as Record<string, unknown>) }
      } else {
        next = nextIsIndex ? [] : {}
      }
      if (Array.isArray(cursor)) {
        cursor[Number(segment)] = next
      } else {
        (cursor as Record<string, unknown>)[segment] = next
      }
      cursor = next
    }
    const leaf = segments[segments.length - 1]
    if (Array.isArray(cursor)) {
      cursor[Number(leaf)] = value
    } else {
      (cursor as Record<string, unknown>)[leaf] = value
    }
  }
  return result
}

// ── Field descriptions from the data dictionary ───────────────────────────────

interface DataDictionaryEntry {
  type?: string
  required?: boolean | string
  description?: string
}

let dictionaryCache: Record<string, DataDictionaryEntry> | null = null

function loadDataDictionary(): Record<string, DataDictionaryEntry> {
  if (dictionaryCache) return dictionaryCache
  try {
    const root = resolveNodeEstateGeneratorRoot()
    const raw = fs.readFileSync(path.join(root, 'schemas', 'data-dictionary.json'), 'utf8')
    dictionaryCache = JSON.parse(raw) as Record<string, DataDictionaryEntry>
  } catch {
    dictionaryCache = {}
  }
  return dictionaryCache
}

function humanizePath(fieldPath: string): string {
  return fieldPath
    .split('.')
    .map(segment => /^\d+$/.test(segment)
      ? `#${Number(segment) + 1}`
      : segment.split('_').map(word => (word ? word[0].toUpperCase() + word.slice(1) : word)).join(' '))
    .join(' — ')
}

export interface QuickDraftFieldInfo {
  path: string
  label: string
  type: string
  description: string | null
}

/** Dictionary lookup keyed with numeric indices normalized to `[]` notation. */
export function describeField(fieldPath: string): QuickDraftFieldInfo {
  const dictionary = loadDataDictionary()
  const normalized = fieldPath.replace(/\.\d+(?=\.|$)/g, '[]')
  const entry = dictionary[normalized] ?? dictionary[fieldPath]
  return {
    path: fieldPath,
    label: humanizePath(fieldPath),
    type: entry?.type ?? 'string',
    description: entry?.description ?? null,
  }
}

// ── Single-template render ────────────────────────────────────────────────────

export interface RenderSingleTemplateArgs {
  matterId: string
  templateId: string
  /** Dot-path → value answers from the quick-draft form. */
  overrides?: Record<string, string>
  /**
   * Render this buffer instead of the resolved published/bundled template
   * (used by template-candidate validation).
   */
  templateBuffer?: Buffer
  /** Tolerate non-hired matters and missing design sheets. */
  allowPartial?: boolean
}

export interface QuickDraftRenderResult {
  buffer: Buffer
  outputFilename: string
  title: string
  /** Owning estate package, or 'custom' for attorney-uploaded templates. */
  packageName: NodeEstatePackageName | 'custom'
  unresolvedMarkers: string[]
  missingFields: string[]
  warnings: string[]
  definition: DocumentTemplateDefinition
  templateSource: 'bundled' | 'published'
  templateVersionId: string | null
  designSheetId: string | null
  ownerName: string | null
}

/**
 * Render exactly one estate template for a matter. Whatever the payload cannot
 * resolve surfaces in `missingFields` (as `[[ MISSING: path ]]` holes in the
 * buffer) rather than failing — the caller decides whether that blocks.
 */
export async function renderSingleTemplateForMatter(
  args: RenderSingleTemplateArgs,
): Promise<QuickDraftRenderResult> {
  const customRowId = customTemplateRowId(args.templateId)
  if (customRowId) return renderCustomTemplateForMatter(customRowId, args)
  const definition = getDocumentTemplateDefinition(args.templateId)
  if (!definition) throw new Error(`Unknown document template: ${args.templateId}`)
  if (definition.category !== 'estate') {
    throw new Error(`Quick draft supports estate templates only (got ${definition.category}).`)
  }

  let templateBuffer = args.templateBuffer
  let templateSource: 'bundled' | 'published' = 'bundled'
  let templateVersionId: string | null = null
  if (!templateBuffer) {
    const resolved = await resolveDocumentTemplate(args.templateId)
    templateBuffer = resolved.buffer
    templateSource = resolved.source
    templateVersionId = resolved.versionId
  }

  const payload = await buildDraftPayload(args.matterId, { allowPartial: args.allowPartial })
  const root = resolveNodeEstateGeneratorRoot()
  const templateRelative = definition.bundledPath.replace(/^tools\/aubreylaw-docgeneration\//, '')
  const packageName = definition.packageNames.find(name => {
    try {
      return loadNodeEstatePackage(name as NodeEstatePackageName, root).documents.some(doc => doc.template === templateRelative)
    } catch {
      return false
    }
  }) as NodeEstatePackageName | undefined
  if (!packageName) throw new Error('No estate package references this template.')
  const config = loadNodeEstatePackage(packageName, root)
  const document = config.documents.find(item => item.template === templateRelative)!

  const data = toEstateGeneratorData(payload) as unknown as NodeEstateData
  let packageData = dataForNodeEstatePackage(data, packageName)
  if (args.overrides && Object.keys(args.overrides).length > 0) {
    packageData = applyFieldOverrides(packageData, args.overrides)
  }
  const state = normalizeJurisdictionStateCode(payload.client.state)
  const context = buildNodeEstateContext({ data: packageData, state, root })
  const clauses = createNodeClauseStore({ root, state, allowDraft: true })
  const rendered = renderNodeEstateDocxTemplate({ templateBuffer, context, clauses })

  const packageClient = (packageData as { client?: { full_name?: unknown } }).client
  const ownerName = typeof packageClient?.full_name === 'string' && packageClient.full_name.trim()
    ? packageClient.full_name.trim()
    : null

  return {
    buffer: rendered.buffer,
    outputFilename: document.output,
    title: document.title,
    packageName,
    unresolvedMarkers: rendered.unresolvedMarkers,
    missingFields: rendered.missingFields,
    warnings: clauses.report.warnings,
    definition,
    templateSource,
    templateVersionId,
    designSheetId: payload.design_sheet_id,
    ownerName: ownerName ?? payload.client.full_name ?? null,
  }
}

/**
 * Attorney-uploaded templates render against the full generator data (no
 * package-specific reshaping) with the same clause store and context, so
 * `{{ client.full_name }}`, `{{ extras.* }}`, and `include_clause(...)` all
 * work exactly as they do in bundled templates.
 */
async function renderCustomTemplateForMatter(
  rowId: string,
  args: RenderSingleTemplateArgs,
): Promise<QuickDraftRenderResult> {
  const row = await getCustomTemplate(rowId)
  if (!row) throw new Error(`Unknown document template: ${args.templateId}`)
  const templateBuffer = args.templateBuffer ?? await resolveCustomTemplateBuffer(row)

  const payload = await buildDraftPayload(args.matterId, { allowPartial: args.allowPartial })
  const root = resolveNodeEstateGeneratorRoot()
  let data = toEstateGeneratorData(payload) as unknown as NodeEstateData
  if (args.overrides && Object.keys(args.overrides).length > 0) {
    data = applyFieldOverrides(data, args.overrides)
  }
  const state = normalizeJurisdictionStateCode(payload.client.state)
  const context = buildNodeEstateContext({ data, state, root })
  const clauses = createNodeClauseStore({ root, state, allowDraft: true })
  const rendered = renderNodeEstateDocxTemplate({ templateBuffer, context, clauses })

  return {
    buffer: rendered.buffer,
    outputFilename: row.output_filename,
    title: row.label,
    packageName: 'custom',
    unresolvedMarkers: rendered.unresolvedMarkers,
    missingFields: rendered.missingFields,
    warnings: clauses.report.warnings,
    definition: {
      id: args.templateId,
      label: row.label,
      category: 'estate',
      renderer: 'estate_nunjucks',
      bundledPath: '',
      packageNames: [],
    },
    templateSource: 'published',
    templateVersionId: null,
    designSheetId: payload.design_sheet_id,
    ownerName: payload.client.full_name ?? null,
  }
}
