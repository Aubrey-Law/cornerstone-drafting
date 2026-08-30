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
import { getTrustPlanningType } from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet } from '@/types/database'

export interface StatularExportContext {
  clientName: string | null
  spouseName: string | null
  matterNumber: string | null
  /** ISO date; injected so the output is deterministic under test. */
  exportedOn: string
}

/**
 * Our section names in the order Statular's interview asks for them, each
 * annotated with the pages it feeds.
 *
 * The mapping is section-to-page, not field-to-page: our `Trust` section spans
 * four Statular pages and splitting it would mean inventing a per-field
 * assignment we cannot verify. Naming the pages a section feeds gives the
 * extractor the routing hint without that guesswork.
 */
const SECTION_ORDER: Array<{ section: string; statularPages: string }> = [
  { section: 'Plan Design', statularPages: 'Document Selection' },
  { section: 'Client Information', statularPages: 'Family Information' },
  { section: 'Personal', statularPages: 'Family Information' },
  { section: 'Family', statularPages: 'Family Information, Guardian Designations' },
  { section: 'Trust', statularPages: 'Living Trust Details, Successor Trustees, Death of Deceased Settlor, Death of Surviving Settlor' },
  { section: 'Will', statularPages: 'Will & Executors' },
  { section: 'Durable Power of Attorney', statularPages: 'PoA Provisions, Power of Attorney' },
  { section: 'Health Care Documents', statularPages: 'Health Care Proxy, Dementia Directive, Healthcare Forms, Post-Death Choices' },
  { section: 'Assets', statularPages: 'Asset Schedules' },
  { section: 'Signing and Execution', statularPages: 'Signing Information' },
  { section: 'Goals & Notes', statularPages: '—' },
]

/**
 * Statular's own wording for the marital and bypass answers, taken from its
 * interview screens. Keyed by our stored value, so a value that gains a label
 * here stops falling through to the generic humaniser.
 */
const STATULAR_OPTION_LABELS: Record<string, Record<string, string>> = {
  marital_trust: {
    none: 'None — do not create a separate marital deduction trust',
    general_power_of_appointment: 'General Power of Appointment Trust',
    qtip: 'Qualified Terminable Interest Property Trust (QTIP)',
  },
  marital_trust_invasion: {
    no_invasion: 'No Invasion',
    hems: 'Invasion for HEMS',
    five_by_five: '"5 by 5" Invasion Power',
    complete: 'Complete Invasion Power',
  },
  marital_trust_remainder_power: {
    none: 'No appointment power',
    limited_testamentary: 'Limited testamentary power',
  },
  bypass_trust: {
    none: 'None — do not create a bypass trust',
    bypass: 'Bypass/Credit-Shelter Trust (A/B)',
    disclaimer: 'Disclaimer Trust (contingent, funded only by a disclaimer)',
  },
  bypass_trust_formula: {
    all_assets: 'All Assets',
    formula: 'Formula',
    fixed_amount: 'Fixed Amount',
    percentage: 'Percentage',
    clayton_election: 'Clayton Election',
  },
  bypass_trust_remainder_power: {
    none: 'No appointment power',
    limited_testamentary: 'Limited testamentary power',
  },
}

/**
 * The marital and bypass keys, in interview order, with Statular's question
 * wording. Hoisted out of the generic `Trust` dump into their own section, and
 * excluded from it, so each appears exactly once and under the label Statular
 * would recognise.
 */
const MARITAL_BYPASS_QUESTIONS: Array<{ key: string; question: string }> = [
  { key: 'marital_trust', question: 'Marital Trust' },
  { key: 'marital_trust_invasion', question: 'Marital Trust Invasion Powers' },
  { key: 'marital_trust_remainder_power', question: 'QTIP Remainder Power of Appointment' },
  { key: 'marital_trust_include_qdot', question: 'Include QDOT Language' },
  { key: 'bypass_trust', question: 'Bypass Trust' },
  { key: 'bypass_trust_formula', question: 'Bypass Trust Formula' },
  { key: 'bypass_trust_fixed_amount', question: 'Fixed Amount' },
  { key: 'bypass_trust_percentage', question: 'Percentage' },
  { key: 'bypass_trust_remainder_power', question: 'Bypass Trust Power of Appointment' },
  { key: 'bypass_trust_allow_sprinkling', question: 'Allow Discretionary Sprinkling' },
]

/**
 * Columns Statular's Signing Information page asks for that the import registry
 * does not name. Their absence there is deliberate — the document importer must
 * not propose an execution date or a notary commission — but exporting them is
 * the opposite direction and perfectly safe, so they are listed explicitly
 * rather than left out of the file Statular is meant to read.
 */
const EXECUTION_FIELDS: Array<{ field: keyof DesignSheet; label: string }> = [
  { field: 'signing_date', label: 'Signing date' },
  { field: 'signing_month', label: 'Signing month' },
  { field: 'signing_year', label: 'Signing year' },
  { field: 'signing_county', label: 'Signing county' },
  { field: 'notary_commission_expiration', label: 'Notary commission expiration' },
]

const MARITAL_BYPASS_FIELDS = new Set(
  MARITAL_BYPASS_QUESTIONS.map(entry => `trust_details.${entry.key}`),
)

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

/** A single answer, or null when the field is unanswered and should be omitted. */
function formatValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (field.endsWith('fixed_amount')) return formatCurrency(value)
    if (field.endsWith('percentage')) return `${value}%`
    return String(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const bare = field.includes('.') ? field.slice(field.indexOf('.') + 1) : field
    return STATULAR_OPTION_LABELS[bare]?.[trimmed] ?? humanize(trimmed)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value.map(entry => formatArrayEntry(entry)).filter(Boolean).join('; ') || null
  }

  if (isRecord(value)) {
    const inner = formatArrayEntry(value)
    return inner || null
  }

  return null
}

/** Records inside a list (children, assets, charities) render as `key: value` pairs. */
function formatArrayEntry(entry: unknown): string {
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

/** Current value of any registry field, column-backed or `decisions`-backed. */
function readFieldValue(sheet: DesignSheet, field: string): unknown {
  if (field.includes('.')) return readDecisionFieldRaw(sheet, field)
  return (sheet as unknown as Record<string, unknown>)[field]
}

function line(label: string, value: string): string {
  return `- ${label}: ${value}`
}

/**
 * Every registry field belonging to `section`, in registry order, skipping the
 * marital and bypass keys the dedicated section already carries.
 */
function sectionLines(sheet: DesignSheet, section: string): string[] {
  const fields = [
    ...Object.keys(DESIGN_SHEET_IMPORT_FIELDS),
    ...Object.keys(DESIGN_SHEET_DECISION_FIELDS),
  ]

  const lines: string[] = []
  for (const field of fields) {
    if (MARITAL_BYPASS_FIELDS.has(field)) continue
    const meta = getDesignSheetImportFieldMeta(field)
    if (!meta || meta.section !== section) continue
    const formatted = formatValue(field, readFieldValue(sheet, field))
    if (formatted === null) continue
    lines.push(line(meta.label, formatted))
  }

  if (section === 'Signing and Execution') {
    for (const { field, label } of EXECUTION_FIELDS) {
      const formatted = formatValue(field, sheet[field])
      if (formatted === null) continue
      lines.push(line(label, formatted))
    }
  }

  return lines
}

/**
 * The marital and bypass block, in Statular's wording.
 *
 * Only rendered for a plan that actually divides at the first death: a joint
 * trust, or a separate trust whose residuary is held in trust for the spouse.
 * Anywhere else these keys are leftovers from an earlier answer, and printing
 * them would tell Statular to build a trust this plan does not have.
 */
function maritalBypassLines(sheet: DesignSheet): string[] {
  const planningType = getTrustPlanningType(sheet)
  const dividesAtFirstDeath = sheet.is_joint === true
    || (planningType !== 'outright_to_spouse' && planningType !== 'not_to_spouse')
  if (!dividesAtFirstDeath) return []

  const lines: string[] = []
  for (const { key, question } of MARITAL_BYPASS_QUESTIONS) {
    const field = `trust_details.${key}`
    // Raw, never getTrustDetails: the getter substitutes `false` for an unset
    // boolean, which would print "Include QDOT Language: No" for a question
    // nobody answered — the one thing this file promises not to do.
    const formatted = formatValue(field, readDecisionFieldRaw(sheet, field))
    if (formatted === null) continue
    lines.push(line(question, formatted))
  }
  return lines
}

function heading(title: string, statularPages: string): string {
  return statularPages === '—'
    ? `## ${title}`
    : `## ${title}\n\n_Statular: ${statularPages}_`
}

export function buildStatularExportMarkdown(
  sheet: DesignSheet,
  context: StatularExportContext,
): string {
  const client = context.clientName?.trim() || 'Client'
  const blocks: string[] = []

  const identity = [
    `# Estate Plan Design Sheet — ${client}`,
    '',
    [
      'Exported from the Cornerstone design sheet',
      context.matterNumber ? ` for matter ${context.matterNumber}` : '',
      ` on ${context.exportedOn}, for import into Statular.`,
    ].join(''),
    '',
    'Every line below is an answer the attorney has already decided. Fields left'
    + ' undecided are omitted rather than shown blank, so nothing here should be'
    + ' read as a choice that was made.',
  ].join('\n')
  blocks.push(identity)

  const facts: string[] = []
  if (context.clientName) facts.push(line('Client', context.clientName))
  if (context.spouseName) facts.push(line('Spouse', context.spouseName))
  if (sheet.is_joint !== null && sheet.is_joint !== undefined) {
    facts.push(line('Trust structure', sheet.is_joint ? 'Joint trust' : 'Separate trusts'))
  }
  if (facts.length) blocks.push(`## Matter\n\n${facts.join('\n')}`)

  for (const { section, statularPages } of SECTION_ORDER) {
    const lines = sectionLines(sheet, section)

    if (section === 'Trust') {
      // The marital and bypass questions sit on their own Statular page, so
      // they get their own section rather than trailing the trust dump.
      const marital = maritalBypassLines(sheet)
      if (lines.length) blocks.push(`${heading(section, statularPages)}\n\n${lines.join('\n')}`)
      if (marital.length) {
        blocks.push(
          `${heading(
            'Trusts for Survivor — Marital and Bypass',
            'Death of Deceased Settlor (Trusts for Survivor, Bypass Trust Options)',
          )}\n\n${marital.join('\n')}`,
        )
      }
      continue
    }

    if (!lines.length) continue
    blocks.push(`${heading(section, statularPages)}\n\n${lines.join('\n')}`)
  }

  return `${blocks.join('\n\n')}\n`
}
