import { describe, expect, it } from 'vitest'
import {
  MATTER_EXPORT_HEADERS,
  matterExportCsv,
  matterExportFilename,
  toMatterExportRow,
} from '@/lib/matters/exportRows'
import { csvCell, csvFilename, toCsvText } from '@/lib/csvFile'
import type { MatterListRow } from '@/lib/queries/matters'

/**
 * The matters list as a spreadsheet: the columns the table shows, plus the
 * contact and identity fields a reader needs once the rows leave the app.
 */

const matter = (fields: Partial<MatterListRow> = {}): MatterListRow => ({
  matter_id: 'm1',
  matter_name: 'Smith Family Trust',
  stage: 'design',
  status: 'open',
  flags: null,
  matter_created: '2026-06-01T00:00:00.000Z',
  client_name: 'Sam Smith',
  client_email: 'sam@example.com',
  client_phone: '617-555-0100',
  client_dob: null,
  client_address: null,
  spouse_name: null,
  spouse_email: null,
  spouse_phone: null,
  spouse_dob: null,
  spouse_address: null,
  plan_type: null,
  marital_status: null,
  has_minor_children: null,
  taxable_estate: null,
  intake_status: null,
  design_status: null,
  intake_submitted_at: null,
  drafts_sent_at: null,
  signing_date: null,
  documents_executed_at: null,
  next_appointment: null,
  next_appointment_type: null,
  referral_source: null,
  fee_amount: null,
  opened_at: null,
  matter_number: null,
  ...fields,
})

describe('csv text', () => {
  it('quotes what would otherwise break a row, and defuses formulas', () => {
    expect(csvCell('Doe, Jane "JD"')).toBe('"Doe, Jane ""JD"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    // A phone number is text, not a sum.
    expect(csvCell('+1 617 555 0100')).toBe("'+1 617 555 0100")
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc")
    expect(csvCell(null)).toBe('')
  })

  it('writes a header row followed by the rows', () => {
    expect(toCsvText(['A', 'B'], [[1, 2], ['x', null]])).toBe('A,B\n1,2\nx,')
  })

  it('names a file by what it holds and the day it was taken', () => {
    expect(csvFilename('matters', 'signing', new Date('2026-08-30T12:00:00Z')))
      .toBe('cornerstone-matters-signing-2026-08-30.csv')
    expect(csvFilename('matters', 'all', new Date('2026-08-30T12:00:00Z')))
      .toBe('cornerstone-matters-all-2026-08-30.csv')
  })
})

describe('matter export rows', () => {
  it('writes codes as the labels the page shows', () => {
    const row = toMatterExportRow(matter({ practice_area: 'EP', stage: 'design', intake_status: 'in_progress' }))
    expect(row.practiceArea).toBe('Estate Planning')
    // Not the raw enum: a reader of the CSV never sees the app's vocabulary.
    expect(row.stage).not.toBe('design')
    expect(row.stage.length).toBeGreaterThan(0)
    expect(row.intake).toBe('in progress')
  })

  it('leaves an unrecorded practice area blank rather than asserting the default', () => {
    // practiceAreaLabel() falls back to "Estate Planning"; an export must not
    // claim a plan the matter does not record.
    expect(toMatterExportRow(matter({ practice_area: null })).practiceArea).toBe('')
  })

  it('dates the last milestone in ISO so a spreadsheet can sort it', () => {
    const row = toMatterExportRow(matter({
      matter_created: '2026-06-01T00:00:00.000Z',
      drafts_sent_at: '2026-07-15T09:30:00.000Z',
    }))
    expect(row.lastMilestone).toBe('2026-07-15')
    expect(toMatterExportRow(matter({ matter_created: null as unknown as string })).lastMilestone).toBe('')
  })

  it('falls back to the matter name when the client name is missing', () => {
    expect(toMatterExportRow(matter({ client_name: '', matter_name: 'Estate of Doe' })).client)
      .toBe('Estate of Doe')
  })

  it('writes every column the header names, in order', () => {
    const csv = matterExportCsv([toMatterExportRow(matter({
      matter_number: '2026-EP-Smith',
      practice_area: 'EP',
      fee_amount: 4500,
      intake_status: 'submitted',
      drafts_sent_at: '2026-07-15T09:30:00.000Z',
    }))])
    const [header, row] = csv.split('\n')
    expect(header).toBe(MATTER_EXPORT_HEADERS.join(','))
    expect(row.split(',')).toHaveLength(MATTER_EXPORT_HEADERS.length)
    expect(row).toContain('Sam Smith')
    expect(row).toContain('sam@example.com')
    expect(row).toContain('617-555-0100')
    expect(row).toContain('2026-EP-Smith')
    expect(row).toContain('4500')
    expect(row).toContain('2026-07-15')
  })

  it('exports an empty selection as a header alone, not an empty file', () => {
    expect(matterExportCsv([])).toBe(MATTER_EXPORT_HEADERS.join(','))
  })

  it('names the file for the matters it holds', () => {
    expect(matterExportFilename('signing', new Date('2026-08-30T12:00:00Z')))
      .toBe('cornerstone-matters-signing-2026-08-30.csv')
  })
})
