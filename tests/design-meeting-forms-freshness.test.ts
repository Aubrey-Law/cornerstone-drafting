import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_PATH,
  GRANOLA_PATH,
  WORKSHEET_PATH,
  buildDesignMeetingArtifacts,
  meetingArtifactPaths,
  worksheetLine,
} from '../scripts/generate-design-meeting-forms'
import {
  DESIGN_MEETING_SECTIONS,
  MEETING_SPECS,
  PMPS_SECTIONS,
  designMeetingFieldNames,
  meetingFieldNames,
} from '@/lib/designMeeting/formSpec'
import {
  coerceDesignSheetImport,
  getDesignSheetImportFieldMeta,
  matchDesignSheetImportOption,
} from '@/lib/designSheetImport/shared'

/** Every field either meeting's form names. */
function allMeetingFieldNames(): string[] {
  return [...new Set(MEETING_SPECS.flatMap(spec => meetingFieldNames(spec.sections)))]
}

function checkedIn(rel: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), rel))
}

/**
 * The meeting worksheet is only useful if what it prints is what the import
 * validator accepts. `matchDesignSheetImportOption` rejects anything outside a
 * field's option list, so a worksheet offering a stale token would send the
 * attorney's answer to the rejected panel — the failure is silent at the point
 * it is introduced and only shows up on a real client's form.
 */
describe('the worksheet prints values the importer accepts', () => {
  it('names only fields that still exist', () => {
    for (const field of allMeetingFieldNames()) {
      expect(getDesignSheetImportFieldMeta(field), field).not.toBeNull()
    }
  })

  it('prints option tokens that still validate', () => {
    for (const field of allMeetingFieldNames()) {
      const meta = getDesignSheetImportFieldMeta(field)!
      if (!meta.options) continue

      for (const option of meta.options) {
        expect(matchDesignSheetImportOption(option, meta.options), `${field} → ${option}`).toBe(option)
      }
    }
  })

  it('offers every choice a choice field accepts, so no valid answer is unprintable', () => {
    for (const field of allMeetingFieldNames()) {
      const meta = getDesignSheetImportFieldMeta(field)!
      if (!meta.options) continue

      const line = worksheetLine(field)
      for (const option of meta.options) {
        expect(line, `${field} is missing ${option}`).toContain(option)
      }
    }
  })

  it('puts the label and its answer on one line', () => {
    // The upload path is mammoth.extractRawText, which breaks only after
    // paragraphs. A label separated from its answer — as a table row would be —
    // leaves the extractor pairing them positionally down a 40-row form.
    for (const field of allMeetingFieldNames()) {
      const line = worksheetLine(field)
      expect(line, field).not.toContain('\n')
      expect(line, field).toContain(`${getDesignSheetImportFieldMeta(field)!.label}:`)
    }
  })
})

/**
 * The closest thing to a round trip that does not need a model: take the answer
 * the worksheet invites for each field and push it through the real importer.
 * Anything the worksheet can elicit must survive coercion — a field that comes
 * back rejected is one the attorney would have filled in for nothing.
 */
describe('a filled worksheet coerces cleanly', () => {
  it('accepts every answer the form invites, and rejects none', () => {
    const filled: Record<string, unknown> = {}

    for (const field of allMeetingFieldNames()) {
      const meta = getDesignSheetImportFieldMeta(field)!
      if (meta.options) filled[field] = meta.options[0]
      else if (meta.kind === 'boolean') filled[field] = 'yes'
      else if (meta.kind === 'number') filled[field] = '30'
      else if (meta.kind === 'string') filled[field] = 'Sample answer'
    }

    const { proposed, rejected } = coerceDesignSheetImport(filled)

    expect(rejected).toEqual([])
    for (const field of Object.keys(filled)) {
      expect(proposed, field).toHaveProperty(field)
    }
  })

  it('still rejects an answer the field cannot hold', () => {
    // Guards the guard: a coercion that accepted everything would make the test
    // above pass while proving nothing.
    const { rejected } = coerceDesignSheetImport({ bond: 'whatever the client said' })
    expect(rejected.map(row => row.field)).toEqual(['bond'])
  })
})

describe.each(MEETING_SPECS)('the $title spec', spec => {
  it('names no field twice', () => {
    const names = meetingFieldNames(spec.sections)
    expect(names).toEqual([...new Set(names)])
  })

  it('stays short enough to work through at a table', () => {
    // The full proposable set is ~195. A meeting form that size comes back
    // mostly blank; this is the guard on scope creep back toward it.
    expect(meetingFieldNames(spec.sections).length).toBeLessThanOrEqual(60)
  })

  it('gives every section something to capture', () => {
    for (const section of spec.sections) {
      expect(section.fields.length + (section.prompts?.length ?? 0), section.title).toBeGreaterThan(0)
      expect(section.intro, section.title).not.toBe('')
    }
  })
})

describe('the design meeting spec', () => {
  it('keeps its field list', () => {
    expect(designMeetingFieldNames()).toEqual(DESIGN_MEETING_SECTIONS.flatMap(section => section.fields))
  })

  it('asks for fiduciaries as names rather than as fields', () => {
    // The fiduciary proposer reads people out of prose, not out of the field
    // map, so a role captured as a registry field would never reach the People
    // group and never fill a slot.
    const fiduciarySection = DESIGN_MEETING_SECTIONS.find(section => section.title === 'Fiduciaries')!
    expect(fiduciarySection.prompts?.some(prompt => prompt.startsWith('Trustee'))).toBe(true)
    expect(fiduciarySection.fields).not.toContain('trustee_primary')
  })
})

describe('the PMPS spec', () => {
  it('captures what the estate-tax worksheet cannot be computed without', () => {
    const names = meetingFieldNames(PMPS_SECTIONS)
    for (const field of ['assets', 'children', 'client_citizenship', 'county', 'settlor_facts.disabled_veteran']) {
      expect(names, field).toContain(field)
    }
  })

  it('asks who owns each life-insurance policy', () => {
    // Policy ownership is the one people skip and the one that decides
    // whether the death benefit is in the taxable estate.
    const prompts = PMPS_SECTIONS.flatMap(section => section.prompts ?? [])
    expect(prompts.some(prompt => /life insurance/i.test(prompt) && /owns/i.test(prompt))).toBe(true)
  })
})

describe('the Granola recipes', () => {
  it.each(MEETING_SPECS)('$title recipe carries every template label and asks for missing information', async spec => {
    const built = await buildDesignMeetingArtifacts()
    const paths = meetingArtifactPaths(spec)
    const recipe = built.markdown[paths.recipe]
    const template = built.markdown[paths.granola]

    // The recipe's recap has to land on the same labels the template prints,
    // or a note run through it stops matching what the importer was given.
    const labels = template.split('\n').filter(line => line.startsWith('- ') && line.endsWith(':'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(recipe, label).toContain(label)

    expect(recipe).toContain('## Missing information')
    expect(recipe).toContain('## Follow-up tasks')
  })
})

describe('checked-in artifacts are fresh', () => {
  it('match a rebuild — regenerate with `npm run design:forms`', async () => {
    const built = await buildDesignMeetingArtifacts()

    // The design meeting's original paths stay where earlier links point.
    expect(built.markdown).toHaveProperty([CHECKLIST_PATH])
    expect(built.markdown).toHaveProperty([GRANOLA_PATH])
    expect(built.worksheets).toHaveProperty([WORKSHEET_PATH])

    for (const [relative, content] of Object.entries(built.markdown)) {
      expect(checkedIn(relative).toString('utf8'), relative).toBe(content)
    }
    // The generator strips zip timestamps and sorts entries, so the .docx is
    // byte-stable and can be compared directly rather than by proxy.
    for (const [relative, content] of Object.entries(built.worksheets)) {
      expect(checkedIn(relative).equals(content), relative).toBe(true)
    }
  })
})
