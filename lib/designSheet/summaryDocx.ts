/**
 * Internal design sheet summary: every question on the design sheet with its
 * answer, as a Word document.
 *
 * Unlike the Statular export (answers only, so an undecided field cannot be read
 * as a choice), this is a working document for the attorney and staff, so it
 * lists unanswered questions too — marked "Not answered" — which makes gaps
 * visible before drafting. Questions and sections come from the import registry,
 * the same source the Statular fallback uses, so a field added there shows up
 * here with no further work.
 */
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import {
  DESIGN_SHEET_DECISION_FIELDS,
} from '@/lib/designSheetImport/decisionFields'
import {
  DESIGN_SHEET_IMPORT_FIELDS,
  getDesignSheetImportFieldMeta,
} from '@/lib/designSheetImport/shared'
import {
  FALLBACK_SECTION_ORDER,
  formatArrayEntry,
  formatValue,
  readFieldValue,
} from '@/lib/designSheet/statularExport'
import type { DesignSheet } from '@/types/database'

export interface DesignSummaryContext {
  clientName: string | null
  spouseName: string | null
  matterNumber: string | null
  /** ISO date; injected so the output is deterministic under test. */
  exportedOn: string
}

export interface SummaryRow {
  question: string
  /** One entry per line; empty when the question is unanswered. */
  answer: string[]
}

export interface SummarySection {
  title: string
  rows: SummaryRow[]
}

function answerLines(field: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(entry => formatArrayEntry(entry)).filter(Boolean)
  }
  const formatted = formatValue(field, value)
  return formatted === null ? [] : [formatted]
}

/** Every registry question with its current answer, grouped by section. */
export function buildDesignSummarySections(sheet: DesignSheet): SummarySection[] {
  const bySection = new Map<string, SummaryRow[]>()
  const fields = [
    ...Object.keys(DESIGN_SHEET_IMPORT_FIELDS),
    ...Object.keys(DESIGN_SHEET_DECISION_FIELDS),
  ]
  for (const field of fields) {
    const meta = getDesignSheetImportFieldMeta(field)
    if (!meta) continue
    const rows = bySection.get(meta.section) ?? []
    rows.push({ question: meta.label, answer: answerLines(field, readFieldValue(sheet, field)) })
    bySection.set(meta.section, rows)
  }
  const ordered = [
    ...FALLBACK_SECTION_ORDER.filter(section => bySection.has(section)),
    ...[...bySection.keys()].filter(section => !FALLBACK_SECTION_ORDER.includes(section as never)),
  ]
  return ordered.map(title => ({ title, rows: bySection.get(title)! }))
}

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }

function cell(children: Paragraph[], width: number, shade?: string): TableCell {
  return new TableCell({
    children,
    borders: CELL_BORDERS,
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: shade ? { fill: shade } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

function sectionTable(section: SummarySection): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell([new Paragraph({ children: [new TextRun({ text: 'Question', bold: true })] })], 38, 'E7EEF0'),
          cell([new Paragraph({ children: [new TextRun({ text: 'Answer', bold: true })] })], 62, 'E7EEF0'),
        ],
      }),
      ...section.rows.map(row => new TableRow({
        cantSplit: true,
        children: [
          cell([new Paragraph({ children: [new TextRun({ text: row.question })] })], 38),
          cell(
            row.answer.length
              ? row.answer.map(text => new Paragraph({ children: [new TextRun({ text })] }))
              : [new Paragraph({ children: [new TextRun({ text: 'Not answered', italics: true, color: '8A8A8A' })] })],
            62,
          ),
        ],
      })),
    ],
  })
}

export function buildDesignSummaryDocument(sheet: DesignSheet, context: DesignSummaryContext): Document {
  const sections = buildDesignSummarySections(sheet)
  const total = sections.reduce((n, s) => n + s.rows.length, 0)
  const answered = sections.reduce((n, s) => n + s.rows.filter(r => r.answer.length).length, 0)
  const client = context.clientName?.trim() || 'Client'

  const meta: string[] = []
  if (context.matterNumber) meta.push(`Matter ${context.matterNumber}`)
  if (context.spouseName) meta.push(`Spouse: ${context.spouseName}`)
  if (sheet.is_joint !== null && sheet.is_joint !== undefined) {
    meta.push(sheet.is_joint ? 'Joint trust' : 'Separate trusts')
  }
  meta.push(`Exported ${context.exportedOn}`)

  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `Design Sheet Summary — ${client}` })] }),
    new Paragraph({ children: [new TextRun({ text: meta.join('  |  '), color: '595959' })] }),
    new Paragraph({
      spacing: { before: 120, after: 240 },
      children: [new TextRun({
        text: `INTERNAL — NOT FOR CLIENT DISTRIBUTION. ${answered} of ${total} questions answered.`,
        bold: true,
        color: 'A12B2B',
      })],
    }),
  ]
  for (const section of sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 120 },
      keepNext: true,
      children: [new TextRun({ text: section.title })],
    }))
    children.push(sectionTable(section))
  }

  return new Document({
    creator: 'Cornerstone',
    title: `Design Sheet Summary — ${client}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ properties: {}, children }],
  })
}

export async function buildDesignSummaryDocx(
  sheet: DesignSheet,
  context: DesignSummaryContext,
): Promise<Buffer> {
  return Packer.toBuffer(buildDesignSummaryDocument(sheet, context))
}

