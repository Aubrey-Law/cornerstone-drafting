import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { formatDateOnly } from '@/lib/dob'
import { formatPhoneDisplay } from '@/lib/phone'
import { isCollegePrepPracticeArea } from '@/lib/practiceArea'
import {
  CITIZENSHIP_STATUS_OPTIONS,
  ESTATE_VALUE_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  PRONOUN_OPTIONS,
} from '@/lib/sharedFields'
import type { AdminIntakeFormData } from '@/types/adminIntake'

/** Printed where the form leaves an answer blank, so gaps are visible. */
export const EMPTY_VALUE = '—'

export interface IntakeExportRow {
  label: string
  value: string
}

export interface IntakeExportTable {
  headers: string[]
  rows: string[][]
}

export interface IntakeExportSection {
  title: string
  rows: IntakeExportRow[]
  /** Repeating entries (children, fiduciaries) printed as their own grid. */
  table?: IntakeExportTable
  /** Free-form entries printed one per line, for list-shaped sections. */
  lines?: string[]
}

export interface IntakeExportMeta {
  clientName: string
  practiceArea: string
  /** Intake track from the row — 'college_prep' hides assets/spouse/trust. */
  intakeTrack: string | null
  status: string | null
  /** ISO date (YYYY-MM-DD) stamped on the cover line. */
  exportedOn: string
  /** Heading on page one. Defaults to the attorney form's title. */
  documentTitle?: string
}

// ── Value formatting ─────────────────────────────────────────────────────────

function text(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed || EMPTY_VALUE
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return EMPTY_VALUE
}

function date(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed ? formatDateOnly(trimmed) : EMPTY_VALUE
}

function phone(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed ? formatPhoneDisplay(trimmed) : EMPTY_VALUE
}

function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null | undefined,
): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return EMPTY_VALUE
  return options.find(option => option.value === trimmed)?.label ?? trimmed
}

function list(values: readonly string[] | null | undefined): string {
  const kept = (values ?? []).map(v => v.trim()).filter(Boolean)
  return kept.length ? kept.join(', ') : EMPTY_VALUE
}

function fullName(parts: Array<string | null | undefined>): string {
  const joined = parts.map(p => (p ?? '').trim()).filter(Boolean).join(' ')
  return joined || EMPTY_VALUE
}

function checkedList(entries: Array<{ label: string; checked: boolean }>): string {
  const checked = entries.filter(entry => entry.checked).map(entry => entry.label)
  return checked.length ? checked.join(', ') : 'None'
}

function address(form: AdminIntakeFormData): string {
  const street = [form.address_line1, form.address_line2].map(p => p.trim()).filter(Boolean).join(', ')
  const cityLine = [form.city.trim(), [form.state.trim(), form.zip.trim()].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const joined = [street, cityLine].filter(Boolean).join(', ')
  return joined || EMPTY_VALUE
}

// ── Section assembly ─────────────────────────────────────────────────────────

const EXISTING_DOCUMENT_FIELDS = [
  { key: 'has_will', label: 'Current Will' },
  { key: 'has_trust', label: 'Current Trust' },
  { key: 'has_poa', label: 'Power of Attorney' },
  { key: 'has_hcp', label: 'Healthcare Proxy' },
] as const

const COLLEGE_PREP_AGENT_ROLES = [
  { label: 'Financial agent (DPOA)', primary: 'poa_primary', primaryPronouns: 'poa_primary_pronouns', alt: 'poa_alternate', altPronouns: 'poa_alternate_pronouns' },
  { label: 'Health care agent', primary: 'hcp_primary', primaryPronouns: 'hcp_primary_pronouns', alt: 'hcp_alternate', altPronouns: 'hcp_alternate_pronouns' },
] as const

const ESTATE_FIDUCIARY_ROLES = [
  { label: 'Trustee', primary: 'trustee_primary', primaryPronouns: 'trustee_primary_pronouns', alt: 'trustee_alternate', altPronouns: 'trustee_alternate_pronouns' },
  { label: 'Personal Representative / Executor', primary: 'executor_primary', primaryPronouns: 'executor_primary_pronouns', alt: 'executor_alternate', altPronouns: 'executor_alternate_pronouns' },
  { label: 'DPOA Agent', primary: 'poa_primary', primaryPronouns: 'poa_primary_pronouns', alt: 'poa_alternate', altPronouns: 'poa_alternate_pronouns' },
  { label: 'Healthcare Proxy', primary: 'hcp_primary', primaryPronouns: 'hcp_primary_pronouns', alt: 'hcp_alternate', altPronouns: 'hcp_alternate_pronouns' },
] as const

function fiduciaryCell(name: string, pronouns: string): string {
  const trimmedName = name.trim()
  if (!trimmedName) return EMPTY_VALUE
  const pronounLabel = pronouns.trim()
    ? optionLabel(PRONOUN_OPTIONS, pronouns)
    : ''
  return pronounLabel && pronounLabel !== EMPTY_VALUE
    ? `${trimmedName} (${pronounLabel})`
    : trimmedName
}

/**
 * Turn the attorney intake form into printable sections.
 *
 * Section visibility mirrors `AdminIntakeSheet` exactly — a College
 * Preparation Plan intake never asks about assets, a spouse, or a trust, and
 * printing those headings would imply questions that were never put to the
 * client.
 */
export function buildIntakeExportSections(
  form: AdminIntakeFormData,
  meta: IntakeExportMeta,
): IntakeExportSection[] {
  const practiceArea = meta.practiceArea ?? ''
  const isCollegePrep =
    meta.intakeTrack === 'college_prep' || isCollegePrepPracticeArea(practiceArea)
  const lower = practiceArea.toLowerCase()
  const isEstatePlanning = lower.includes('estate planning') || practiceArea === ''
  const showEstatePlanning = isEstatePlanning && !isCollegePrep
  const showProbate = lower.includes('probate') && !isCollegePrep
  const showSpouse = form.marital_status === 'married' && !isCollegePrep
  const showGuardian = form.has_minor_children && !isCollegePrep

  const sections: IntakeExportSection[] = []

  sections.push({
    title: 'Client Information',
    rows: [
      { label: 'Name', value: fullName([form.first_name, form.middle_name, form.last_name, form.suffix]) },
      { label: 'Date of Birth', value: date(form.date_of_birth) },
      { label: 'Citizenship / immigration status', value: optionLabel(CITIZENSHIP_STATUS_OPTIONS, form.citizenship_status) },
      { label: 'Pronouns', value: optionLabel(PRONOUN_OPTIONS, form.preferred_pronoun) },
      { label: 'Email', value: text(form.email) },
      { label: 'Phone', value: phone(form.phone) },
      { label: 'Address', value: address(form) },
      { label: 'County', value: text(form.county) },
      { label: 'Marital Status', value: optionLabel(MARITAL_STATUS_OPTIONS, form.marital_status) },
    ],
  })

  if (showSpouse) {
    sections.push({
      title: 'Spouse / Partner',
      rows: [
        { label: 'Name', value: fullName([form.spouse_first_name, form.spouse_middle_name, form.spouse_last_name]) },
        { label: 'Date of Birth', value: date(form.spouse_date_of_birth) },
        { label: 'Citizenship / immigration status', value: optionLabel(CITIZENSHIP_STATUS_OPTIONS, form.spouse_citizenship_status) },
        { label: 'Pronouns', value: optionLabel(PRONOUN_OPTIONS, form.spouse_preferred_pronoun) },
        { label: 'Date of Marriage', value: date(form.date_of_marriage) },
        { label: 'Email', value: text(form.spouse_email) },
        { label: 'Phone', value: phone(form.spouse_phone) },
      ],
    })
  }

  if (!isCollegePrep) {
    sections.push({
      title: 'Family',
      rows: [
        { label: 'Children?', value: yesNo(form.has_children) },
        { label: 'Minor children (under 18)?', value: yesNo(form.has_minor_children) },
        { label: 'Family notes', value: text(form.family_notes) },
      ],
      table: form.has_children && form.children.length
        ? {
            headers: ['Child', 'Date of Birth', 'Pronouns'],
            rows: form.children.map(child => [
              fullName([child.first_name, child.middle_name, child.last_name]),
              date(child.date_of_birth),
              optionLabel(PRONOUN_OPTIONS, child.preferred_pronoun),
            ]),
          }
        : undefined,
    })

    sections.push({
      title: 'Assets',
      rows: [
        { label: 'Approximate estate value', value: optionLabel(ESTATE_VALUE_OPTIONS, form.estate_value) },
        { label: 'Real property?', value: yesNo(form.has_real_property) },
        ...(form.has_real_property
          ? [
              { label: 'Approx. property value', value: text(form.real_property_value) },
              { label: 'Property address', value: text(form.real_property_address) },
            ]
          : []),
        { label: 'Retirement accounts?', value: yesNo(form.has_retirement) },
        ...(form.has_retirement ? [{ label: 'Approx. value', value: text(form.retirement_value) }] : []),
        { label: 'Life insurance?', value: yesNo(form.has_life_insurance) },
        ...(form.has_life_insurance ? [{ label: 'Death benefit', value: text(form.life_insurance_value) }] : []),
        { label: 'Business interests?', value: yesNo(form.has_business) },
        ...(form.has_business ? [{ label: 'Description', value: text(form.business_description) }] : []),
        { label: 'Investment accounts?', value: yesNo(form.has_investments) },
      ],
    })
  }

  if (showEstatePlanning) {
    sections.push({
      title: 'Estate Planning Goals',
      rows: [
        { label: 'Goals & wishes', value: text(form.planning_objectives) },
        {
          label: 'Existing documents',
          value: checkedList(
            EXISTING_DOCUMENT_FIELDS.map(field => ({ label: field.label, checked: form[field.key] })),
          ),
        },
        { label: 'Special circumstances', value: list(form.special_circumstances) },
      ],
    })
  }

  if (showEstatePlanning || isCollegePrep) {
    const roles = isCollegePrep ? COLLEGE_PREP_AGENT_ROLES : ESTATE_FIDUCIARY_ROLES
    const rows = roles.map(role => [
      role.label,
      fiduciaryCell(form[role.primary], form[role.primaryPronouns]),
      fiduciaryCell(form[role.alt], form[role.altPronouns]),
    ])
    if (showGuardian) {
      rows.push([
        'Guardian for minor children',
        fiduciaryCell(form.guardian_primary, form.guardian_primary_pronouns),
        fiduciaryCell(form.guardian_alternate, form.guardian_alternate_pronouns),
      ])
    }
    sections.push({
      title: isCollegePrep ? 'Agents' : 'Fiduciaries',
      rows: [],
      table: { headers: ['Role', 'Primary', 'Successor / alternate'], rows },
    })
  }

  if (showProbate) {
    sections.push({
      title: 'Probate Details',
      rows: [
        { label: 'Decedent name', value: text(form.pb_decedent_name) },
        { label: 'Date of death', value: date(form.pb_date_of_death) },
        { label: 'Domicile at death', value: text(form.pb_domicile) },
        { label: 'Approx. estate value', value: text(form.pb_estate_value) },
        { label: 'Known assets', value: text(form.pb_known_assets) },
        { label: 'Known debts / liabilities', value: text(form.pb_known_debts) },
        { label: 'Petitioner relationship to decedent', value: text(form.pb_petitioner_relationship) },
        { label: 'Goals / timeline notes', value: text(form.pb_goals_timeline) },
      ],
    })
  }

  sections.push({
    title: 'Internal Notes',
    rows: [{ label: 'Notes', value: text(form.special_notes) }],
  })

  return sections
}

// ── Word rendering ───────────────────────────────────────────────────────────

const FONT = 'Garamond'
const BODY_SIZE = 22 // half-points → 11pt
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' } as const
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER } as const
const CELL_MARGINS = { top: 60, bottom: 60, left: 120, right: 120 } as const
/** Label column of the two-column field tables. */
const LABEL_COLUMN_PERCENT = 34

function bodyRun(value: string, opts: { bold?: boolean } = {}) {
  return new TextRun({ text: value, font: FONT, size: BODY_SIZE, bold: opts.bold })
}

/** A textarea answer keeps its line breaks: one paragraph per line. */
function valueParagraphs(value: string): Paragraph[] {
  const lines = value.split('\n')
  return lines.map(line => new Paragraph({
    children: [bodyRun(line)],
    spacing: { before: 0, after: 0 },
  }))
}

function labelCell(value: string, widthPercent: number): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [bodyRun(value, { bold: true })], spacing: { before: 0, after: 0 } })],
  })
}

function valueCell(value: string, widthPercent: number): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    children: valueParagraphs(value),
  })
}

function fieldTable(rows: IntakeExportRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(row => new TableRow({
      children: [
        labelCell(row.label, LABEL_COLUMN_PERCENT),
        valueCell(row.value, 100 - LABEL_COLUMN_PERCENT),
      ],
    })),
  })
}

function gridTable(table: IntakeExportTable): Table {
  const columnWidth = Math.floor(100 / Math.max(table.headers.length, 1))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: table.headers.map(header => labelCell(header, columnWidth)),
      }),
      ...table.rows.map(cells => new TableRow({
        children: cells.map(cell => valueCell(cell, columnWidth)),
      })),
    ],
  })
}

/** Build the Word document for one intake form. */
export function buildIntakeWordDocument(
  sections: IntakeExportSection[],
  meta: IntakeExportMeta,
): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({
        text: meta.documentTitle ?? 'Client Intake Form',
        font: FONT,
        size: 32,
        bold: true,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: [
            meta.clientName.trim() || 'Client',
            meta.practiceArea.trim(),
            meta.status ? `Status: ${meta.status}` : '',
            `Exported ${meta.exportedOn}`,
          ].filter(Boolean).join(' · '),
          font: FONT,
          size: 18,
          color: '595959',
        }),
      ],
    }),
  ]

  for (const section of sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' } },
      children: [new TextRun({ text: section.title, font: FONT, size: 24, bold: true })],
    }))
    if (section.rows.length) children.push(fieldTable(section.rows))
    if (section.lines?.length) {
      for (const line of section.lines) {
        children.push(new Paragraph({
          children: [bodyRun(line)],
          spacing: { before: 0, after: 40 },
        }))
      }
    }
    if (section.table) {
      if (section.rows.length || section.lines?.length) {
        children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
      }
      children.push(gridTable(section.table))
    }
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_SIZE } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      children,
    }],
  })
}

/** `Intake-Form-Jane-Smith-2026-09-10.docx` — safe for a Content-Disposition. */
export function intakeExportFilename(clientName: string, exportedOn: string): string {
  const slug = (clientName || 'client')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'client'
  return `Intake-Form-${slug}-${exportedOn}.docx`
}
