/**
 * Render the design sheet as a Markdown document for Statular's file import.
 *
 * Statular ingests uploaded files (PDF, DOCX, CSV, XLSX, JSON, TXT, MD, XML,
 * audio) and extracts answers from them — it does not parse a published schema.
 * So the job here is legibility to an extraction model, not conformance:
 *
 * - Markdown, because it is on Statular's accepted list and loses nothing on the
 *   way in. The generator-data JSON export (`?format=json`) is also accepted,
 *   but it is keyed by our template paths and stores `qtip`, not the words
 *   Statular's own interview uses. This file trades that for its vocabulary.
 * - Statular's exact question and option wording wherever we know it — the
 *   marital and bypass trust block, which the interview screens spell out. The
 *   closer a line is to what Statular would have written itself, the less there
 *   is for its extractor to guess.
 * - Answers only. An unanswered field is omitted rather than emitted blank, so
 *   nothing in the file can be read as a decision the attorney did not make.
 *
 * Field labels for everything else come from the import registry
 * (`lib/designSheetImport/`), which already names every design-sheet field for
 * the import preview. Reusing it means a field added there is exported here for
 * free, and the two directions cannot drift apart.
 */
import {
  DESIGN_SHEET_DECISION_FIELDS,
  readDecisionFieldRaw,
} from '@/lib/designSheetImport/decisionFields'
import {
  DESIGN_SHEET_IMPORT_FIELDS,
  getDesignSheetImportFieldMeta,
} from '@/lib/designSheetImport/shared'
import {
  STATULAR_INTERVIEW,
  STATULAR_MAPPED_FIELDS,
} from '@/lib/designSheet/statularInterviewMap'
import type { DesignSheet } from '@/types/database'

export interface StatularExportContext {
  clientName: string | null
  spouseName: string | null
  matterNumber: string | null
  /** ISO date; injected so the output is deterministic under test. */
  exportedOn: string
}

/**
 * Sections the map does not yet place on a Statular question, in a sensible
 * reading order. They print under "Additional answers" with our own labels, so
 * an answer is never dropped just because the map has not reached it.
 */
export const FALLBACK_SECTION_ORDER = [
  'Plan Design',
  'Personal',
  'Client Information',
  'Family',
  'Trust',
  'Will',
  'Durable Power of Attorney',
  'Health Care Documents',
  'Assets',
  'Signing and Execution',
  'Goals & Notes',
] as const

/**
 * Columns Statular's Signing Information page asks for that the import registry
 * does not name. Signing date and county are in the registry — a design meeting
 * settles both — but the month and year are derived from the date when it is
 * applied, and the notary commission is the notary's fact rather than the
 * client's, so none of those three is proposable. Exporting them is the opposite
 * direction and perfectly safe. The map places them; this list is what lets
 * `formatValue` and the fallback know they exist.
 */
const EXTRA_COLUMNS: Record<string, string> = {
  signing_month: 'Signing month',
  signing_year: 'Signing year',
  notary_commission_expiration: 'Notary commission expiration',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `by_representation` → `By representation`. Readable without inventing wording. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : ''
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US')}`
}

/**
 * A single answer, or null when the field is unanswered and should be omitted.
 * `options` is the map's wording for this question's values, when it has any.
 */
export function formatValue(
  field: string,
  value: unknown,
  options?: Record<string, string>,
): string | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'boolean') {
    // A boolean question can still carry Statular wording — "Estate tax payment"
    // is a two-option radio for us and for them, stored as a boolean here.
    return options?.[String(value)] ?? (value ? 'Yes' : 'No')
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (field.endsWith('fixed_amount')) return formatCurrency(value)
    if (field.endsWith('percentage') || field.startsWith('stagger_pct')) return `${value}%`
    return String(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    return options?.[trimmed] ?? humanize(trimmed)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value.map(entry => formatArrayEntry(entry)).filter(Boolean).join('; ') || null
  }

  if (isRecord(value)) return formatArrayEntry(value) || null

  return null
}

/** Records inside a list (children, assets, charities) render as `key: value` pairs. */
export function formatArrayEntry(entry: unknown): string {
  if (entry === null || entry === undefined) return ''
  if (typeof entry === 'string') return entry.trim()
  if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry)
  if (!isRecord(entry)) return ''

  return Object.entries(entry)
    // `id` is a database key with no meaning to a reader or an extractor.
    .filter(([key, value]) => key !== 'id' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${humanize(key)}: ${typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}`)
    .join(', ')
}

/**
 * Current value of any field the map or the registry may name.
 *
 * Decision fields read the RAW blob, never a typed getter: the getters
 * substitute defaults for unset keys, so `getTrustDetails` reports `false` for a
 * boolean nobody has touched. Exporting that would tell Statular the attorney
 * declined a question they never saw — the one thing this file promises not to
 * do. `decisions.<key>` addresses a flat decisions key, which is where
 * `trust_planning_type` lives.
 */
export function readFieldValue(sheet: DesignSheet, field: string): unknown {
  if (field.startsWith('decisions.')) {
    const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
    return decisions[field.slice('decisions.'.length)]
  }
  if (field.includes('.')) return readDecisionFieldRaw(sheet, field)
  return (sheet as unknown as Record<string, unknown>)[field]
}

function line(label: string, value: string): string {
  return `- ${label}: ${value}`
}

/** The mapped pages, rendered in Statular's own words and page order. */
function mappedBlocks(sheet: DesignSheet): string[] {
  const blocks: string[] = []
  let currentPage = ''

  for (const group of STATULAR_INTERVIEW) {
    if (group.appliesTo && !group.appliesTo(sheet)) continue

    const lines: string[] = []
    for (const question of group.questions) {
      const formatted = formatValue(
        question.field,
        readFieldValue(sheet, question.field),
        question.options,
      )
      if (formatted === null) continue
      lines.push(line(question.question, formatted))
    }
    if (!lines.length) continue

    // The page heading prints once, however many of its groups have answers.
    const parts: string[] = []
    if (group.page !== currentPage) {
      parts.push(`## ${group.page}`)
      currentPage = group.page
    }
    if (group.group) parts.push(`### ${group.group}`)
    parts.push(lines.join('\n'))
    blocks.push(parts.join('\n\n'))
  }

  return blocks
}

/**
 * Answered fields the map has not reached yet, grouped by our own section.
 *
 * This is the safety net that lets the map stay incomplete: an answer with no
 * Statular question yet still reaches Statular, just under our label instead of
 * theirs. The section shrinks as the map grows.
 */
function fallbackBlocks(sheet: DesignSheet): string[] {
  const fields = [
    ...Object.keys(DESIGN_SHEET_IMPORT_FIELDS),
    ...Object.keys(DESIGN_SHEET_DECISION_FIELDS),
  ].filter(field => !STATULAR_MAPPED_FIELDS.has(field))

  const bySection = new Map<string, string[]>()
  for (const field of fields) {
    const meta = getDesignSheetImportFieldMeta(field)
    if (!meta) continue
    const formatted = formatValue(field, readFieldValue(sheet, field))
    if (formatted === null) continue
    const existing = bySection.get(meta.section) ?? []
    existing.push(line(meta.label, formatted))
    bySection.set(meta.section, existing)
  }

  for (const [field, label] of Object.entries(EXTRA_COLUMNS)) {
    if (STATULAR_MAPPED_FIELDS.has(field)) continue
    const formatted = formatValue(field, readFieldValue(sheet, field))
    if (formatted === null) continue
    const existing = bySection.get('Signing and Execution') ?? []
    existing.push(line(label, formatted))
    bySection.set('Signing and Execution', existing)
  }

  const ordered = [
    ...FALLBACK_SECTION_ORDER.filter(section => bySection.has(section)),
    ...[...bySection.keys()].filter(section => !FALLBACK_SECTION_ORDER.includes(section as never)),
  ]

  const blocks = ordered.map(section => `### ${section}\n\n${bySection.get(section)!.join('\n')}`)
  if (!blocks.length) return []

  return [
    '## Additional answers\n\n_Not yet matched to a Statular question; labels are the'
    + " design sheet's own._",
    ...blocks,
  ]
}

export function buildStatularExportMarkdown(
  sheet: DesignSheet,
  context: StatularExportContext,
): string {
  const client = context.clientName?.trim() || 'Client'
  const blocks: string[] = [
    [
      `# Estate Plan Design Sheet — ${client}`,
      '',
      'Exported from the Cornerstone design sheet'
        + (context.matterNumber ? ` for matter ${context.matterNumber}` : '')
        + ` on ${context.exportedOn}, for import into Statular. Headings and question`
        + " wording follow Statular's own interview.",
      '',
      'Every line below is an answer the attorney has already decided. Fields left'
      + ' undecided are omitted rather than shown blank, so nothing here should be'
      + ' read as a choice that was made.',
    ].join('\n'),
  ]

  const facts: string[] = []
  if (context.clientName) facts.push(line('Client', context.clientName))
  if (context.spouseName) facts.push(line('Spouse', context.spouseName))
  if (sheet.is_joint !== null && sheet.is_joint !== undefined) {
    facts.push(line('Trust structure', sheet.is_joint ? 'Joint trust' : 'Separate trusts'))
  }
  if (facts.length) blocks.push(`## Matter\n\n${facts.join('\n')}`)

  blocks.push(...mappedBlocks(sheet))
  blocks.push(...fallbackBlocks(sheet))

  return `${blocks.join('\n\n')}\n`
}
