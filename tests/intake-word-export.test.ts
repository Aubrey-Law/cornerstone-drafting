import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Packer } from 'docx'
import PizZip from 'pizzip'
import {
  EMPTY_VALUE,
  buildIntakeExportSections,
  buildIntakeWordDocument,
  intakeExportFilename,
  type IntakeExportMeta,
  type IntakeExportSection,
} from '@/lib/intake/wordExport'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'
import type { AdminIntakeFormData } from '@/types/adminIntake'

function form(overrides: Partial<AdminIntakeFormData> = {}): AdminIntakeFormData {
  return { ...emptyAdminIntakeFormData(), ...overrides }
}

function meta(overrides: Partial<IntakeExportMeta> = {}): IntakeExportMeta {
  return {
    clientName: 'Jane Smith',
    practiceArea: 'Estate Planning',
    intakeTrack: 'estate',
    status: 'draft',
    exportedOn: '2026-09-10',
    ...overrides,
  }
}

function titles(sections: IntakeExportSection[]): string[] {
  return sections.map(section => section.title)
}

function valueOf(sections: IntakeExportSection[], title: string, label: string): string | undefined {
  return sections.find(s => s.title === title)?.rows.find(r => r.label === label)?.value
}

describe('intake Word export — sections', () => {
  it('prints the estate-planning sections with formatted values', () => {
    const sections = buildIntakeExportSections(
      form({
        first_name: 'Jane',
        middle_name: 'Q',
        last_name: 'Smith',
        suffix: 'Esq.',
        date_of_birth: '1972-04-08',
        citizenship_status: 'us_citizen',
        preferred_pronoun: 'she/her',
        email: 'jane@example.com',
        phone: '6175550100',
        address_line1: '12 Elm St',
        address_line2: 'Apt 3',
        city: 'Newton',
        state: 'MA',
        zip: '02458',
        county: 'Middlesex',
        marital_status: 'married',
        estate_value: '500k_2m',
        has_real_property: true,
        real_property_address: '12 Elm St, Newton MA',
        real_property_value: '$750,000',
        planning_objectives: 'Avoid probate.',
        has_will: true,
        has_hcp: true,
        special_circumstances: ['Blended family', 'Tax planning'],
        trustee_primary: 'Alex Smith',
        trustee_primary_pronouns: 'he/him',
      }),
      meta(),
    )

    expect(titles(sections)).toEqual([
      'Client Information',
      'Spouse / Partner',
      'Family',
      'Assets',
      'Estate Planning Goals',
      'Fiduciaries',
      'Internal Notes',
    ])
    expect(valueOf(sections, 'Client Information', 'Name')).toBe('Jane Q Smith Esq.')
    expect(valueOf(sections, 'Client Information', 'Date of Birth')).toBe('Apr 8, 1972')
    expect(valueOf(sections, 'Client Information', 'Citizenship / immigration status')).toBe('US Citizen')
    expect(valueOf(sections, 'Client Information', 'Pronouns')).toBe('She/Her')
    expect(valueOf(sections, 'Client Information', 'Phone')).toBe('(617) 555-0100')
    expect(valueOf(sections, 'Client Information', 'Address')).toBe('12 Elm St, Apt 3, Newton, MA 02458')
    expect(valueOf(sections, 'Client Information', 'Marital Status')).toBe('Married')
    expect(valueOf(sections, 'Assets', 'Approximate estate value')).toBe('$500,000 to $2 million')
    expect(valueOf(sections, 'Assets', 'Property address')).toBe('12 Elm St, Newton MA')
    expect(valueOf(sections, 'Estate Planning Goals', 'Existing documents'))
      .toBe('Current Will, Healthcare Proxy')
    expect(valueOf(sections, 'Estate Planning Goals', 'Special circumstances'))
      .toBe('Blended family, Tax planning')
  })

  it('marks unanswered fields rather than dropping them', () => {
    const sections = buildIntakeExportSections(form(), meta())

    expect(valueOf(sections, 'Client Information', 'Name')).toBe(EMPTY_VALUE)
    expect(valueOf(sections, 'Client Information', 'Date of Birth')).toBe(EMPTY_VALUE)
    expect(valueOf(sections, 'Internal Notes', 'Notes')).toBe(EMPTY_VALUE)
    // Unchecked checkbox groups read as "None", not as a missing answer.
    expect(valueOf(sections, 'Estate Planning Goals', 'Existing documents')).toBe('None')
  })

  it('omits the spouse section unless the client is married', () => {
    const single = buildIntakeExportSections(form({ marital_status: 'single' }), meta())
    expect(titles(single)).not.toContain('Spouse / Partner')

    const married = buildIntakeExportSections(form({ marital_status: 'married' }), meta())
    expect(titles(married)).toContain('Spouse / Partner')
  })

  it('lists children in their own grid and pairs fiduciaries with pronouns', () => {
    const sections = buildIntakeExportSections(
      form({
        has_children: true,
        has_minor_children: true,
        children: [
          { id: 'c1', first_name: 'Robin', middle_name: '', last_name: 'Smith', date_of_birth: '2014-06-01', preferred_pronoun: 'they/them' },
        ],
        trustee_primary: 'Alex Smith',
        trustee_primary_pronouns: 'he/him',
        guardian_primary: 'Pat Jones',
      }),
      meta(),
    )

    const family = sections.find(s => s.title === 'Family')
    expect(family?.table?.headers).toEqual(['Child', 'Date of Birth', 'Pronouns'])
    expect(family?.table?.rows).toEqual([['Robin Smith', 'Jun 1, 2014', 'They/Them']])

    const fiduciaries = sections.find(s => s.title === 'Fiduciaries')
    expect(fiduciaries?.table?.rows[0]).toEqual(['Trustee', 'Alex Smith (He/Him)', EMPTY_VALUE])
    // The guardian row only appears when there are minor children — same rule
    // the sheet uses to show the field.
    expect(fiduciaries?.table?.rows.at(-1)).toEqual([
      'Guardian for minor children', 'Pat Jones', EMPTY_VALUE,
    ])
  })

  it('drops the guardian row when there are no minor children', () => {
    const sections = buildIntakeExportSections(form({ has_minor_children: false }), meta())
    const roles = sections.find(s => s.title === 'Fiduciaries')?.table?.rows.map(row => row[0])
    expect(roles).not.toContain('Guardian for minor children')
  })

  it('exports the College Preparation Plan track without assets, spouse, or trust questions', () => {
    const sections = buildIntakeExportSections(
      form({ marital_status: 'married', poa_primary: 'Dana Lee' }),
      meta({ practiceArea: 'College Preparation Plan', intakeTrack: 'college_prep' }),
    )

    expect(titles(sections)).toEqual(['Client Information', 'Agents', 'Internal Notes'])
    const agents = sections.find(s => s.title === 'Agents')
    expect(agents?.table?.rows.map(row => row[0])).toEqual([
      'Financial agent (DPOA)', 'Health care agent',
    ])
    expect(agents?.table?.rows[0][1]).toBe('Dana Lee')
  })

  it('exports probate details instead of estate-planning goals for a probate matter', () => {
    const sections = buildIntakeExportSections(
      form({ pb_decedent_name: 'Ruth Smith', pb_date_of_death: '2026-01-15' }),
      meta({ practiceArea: 'Probate' }),
    )

    expect(titles(sections)).toContain('Probate Details')
    expect(titles(sections)).not.toContain('Estate Planning Goals')
    expect(titles(sections)).not.toContain('Fiduciaries')
    expect(valueOf(sections, 'Probate Details', 'Decedent name')).toBe('Ruth Smith')
    expect(valueOf(sections, 'Probate Details', 'Date of death')).toBe('Jan 15, 2026')
  })
})

describe('intake Word export — document', () => {
  it('packs a Word file whose text carries the answers', async () => {
    const data = form({
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@example.com',
      marital_status: 'married',
      spouse_first_name: 'Alex',
      spouse_last_name: 'Smith',
      special_notes: 'First line\nSecond line',
    })
    const exportMeta = meta()
    const document = buildIntakeWordDocument(buildIntakeExportSections(data, exportMeta), exportMeta)
    const buffer = await Packer.toBuffer(document)

    const xml = new PizZip(buffer).file('word/document.xml')?.asText() ?? ''
    expect(xml).toContain('Client Intake Form')
    expect(xml).toContain('Jane Smith')
    expect(xml).toContain('jane@example.com')
    expect(xml).toContain('Spouse / Partner')
    expect(xml).toContain('Alex Smith')
    expect(xml).toContain('Exported 2026-09-10')
    // A multi-line note keeps its line breaks as separate paragraphs.
    expect(xml).toContain('First line')
    expect(xml).toContain('Second line')
  })

  it('builds a dated, filesystem-safe filename', () => {
    expect(intakeExportFilename('Jane Q. Smith', '2026-09-10')).toBe('Intake-Form-Jane-Q-Smith-2026-09-10.docx')
    expect(intakeExportFilename('', '2026-09-10')).toBe('Intake-Form-client-2026-09-10.docx')
  })
})

describe('intake Word export — wiring', () => {
  it('serves the download from an admin-only route built on the shared mapper', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/intake/[intakeId]/export/route.ts'),
      'utf8',
    )

    expect(route).toContain('requireAdmin(req)')
    expect(route).toContain('loadAdminIntakeRow')
    expect(route).toContain('mapRawIntakeToFormData')
    expect(route).toContain('buildIntakeWordDocument')
    expect(route).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(route).toContain('Content-Disposition')
  })

  it('reads the intake through the same mapper the attorney sheet renders', () => {
    const sheet = fs.readFileSync(path.join(process.cwd(), 'components/AdminIntakeSheet.tsx'), 'utf8')
    const action = fs.readFileSync(path.join(process.cwd(), 'app/actions/adminIntake.ts'), 'utf8')

    expect(sheet).toContain('mapRawIntakeToFormData')
    expect(action).toContain('loadAdminIntakeRow')
  })

  it('wires the sheet button to save unsaved edits before downloading', () => {
    const sheet = fs.readFileSync(path.join(process.cwd(), 'components/AdminIntakeSheet.tsx'), 'utf8')

    expect(sheet).toContain('async function handleExportWord()')
    expect(sheet).toContain('const intakeIdForExport = isDirty ? await handleSaveDraft() : currentIntakeId')
    expect(sheet).toContain('/api/admin/intake/${intakeIdForExport}/export')
    expect(sheet).toContain('Export Word')
  })
})
