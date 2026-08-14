import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import { buildFerpaRelease, ferpaIncludesHealthCenter } from '@/lib/draftPayload/ferpa'
import { buildCollegePrep } from '@/lib/draftPayload/collegePrep'
import { buildCollegePrepSeedDecisions } from '@/lib/designSheet/seedCollegePrep'
import { setCollegePrepDesign } from '@/lib/collegePrepDesign'
import {
  defaultDocumentInclusions,
  getDocumentInclusions,
  getEstatePlanDesignSetup,
} from '@/lib/designSheetDocumentInclusions'
import { deriveDocuments } from '@/lib/draftPayload/helpers'
import { deriveEstateGeneratorPackages } from '@/lib/estateGenerator/toGeneratorData'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { conditionalMissingFieldsForPackage } from '@/lib/estateGenerator/node/packageValidation'
import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import { designTargetForMissingField } from '@/lib/estateGenerator/missingFieldDesignMap'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import type { DesignSheet } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

const COLLEGE_PREP_DETAILS = {
  school_name: 'Northeastern University',
  school_city: 'Boston',
  school_state: 'MA',
  ferpa_release: true,
  ferpa_records: ['grades', 'billing', 'health_center'],
  ferpa_recipients: 'Alma Delgado and Marcus Delgado, my parents',
  dpoa_effective: 'immediately',
  dpoa_powers: ['banking', 'tuition'],
  hipaa_scope: 'all',
  hipaa_expiration: 'none',
  living_will_include: 'yes',
  life_support: 'comfort_only',
}

function collegePrepIntake(details: Record<string, unknown> = COLLEGE_PREP_DETAILS): IntakeSnapshot {
  return {
    first_name: 'Rowan',
    last_name: 'Delgado',
    intake_track: 'college_prep',
    college_prep_details: details,
    plan_type: null,
    document_inclusions: null,
  } as unknown as IntakeSnapshot
}

function collegePrepSheet(details: Record<string, unknown> = COLLEGE_PREP_DETAILS): DesignSheet {
  return {
    client_name: 'Rowan Delgado',
    matter_type: 'individual',
    marital_status: 'single',
    plan_type: null,
    decisions: buildCollegePrepSeedDecisions(collegePrepIntake(details), null),
  } as unknown as DesignSheet
}

describe('FERPA release — payload', () => {
  it('builds from the college-prep answers', () => {
    const release = buildFerpaRelease(collegePrepSheet())

    expect(release).toMatchObject({
      school_name: 'Northeastern University',
      school_location: 'Boston, MA',
      recipients: 'Alma Delgado and Marcus Delgado, my parents',
      all_records: false,
    })
    expect(release?.records.map(record => record.label)).toEqual([
      'Grades and transcripts',
      'Bursar / tuition account',
      'Campus health / counseling center',
    ])
  })

  it('is absent when the student declined a release', () => {
    const sheet = collegePrepSheet({ ...COLLEGE_PREP_DETAILS, ferpa_release: false })
    expect(buildFerpaRelease(sheet)).toBeNull()
  })

  it('is absent on an estate sheet, which has no education records', () => {
    expect(buildFerpaRelease({ decisions: { document_inclusions: { will: true } } })).toBeNull()
    expect(buildFerpaRelease(null)).toBeNull()
  })

  it('marks an unlimited release when every category is selected', () => {
    const release = buildFerpaRelease(collegePrepSheet({
      ...COLLEGE_PREP_DETAILS,
      ferpa_records: ['grades', 'billing', 'financial_aid', 'housing', 'conduct', 'health_center'],
    }))

    expect(release?.all_records).toBe(true)
  })

  it('flags the campus health center, which FERPA does not reach', () => {
    const release = buildFerpaRelease(collegePrepSheet())
    expect(release?.includes_health_center).toBe(true)
    expect(ferpaIncludesHealthCenter(release)).toBe(true)

    const withoutHealthCenter = buildFerpaRelease(collegePrepSheet({
      ...COLLEGE_PREP_DETAILS,
      ferpa_records: ['grades'],
    }))
    expect(withoutHealthCenter?.includes_health_center).toBe(false)
    expect(ferpaIncludesHealthCenter(withoutHealthCenter)).toBe(false)
  })

  it('carries the campus ID once the attorney enters one', () => {
    // The questionnaire never asks — an incoming student usually has no campus
    // ID yet — so it arrives through the design sheet, not the seed.
    const sheet = collegePrepSheet()
    expect(buildFerpaRelease(sheet)?.student_id).toBeNull()

    const withId = { ...sheet, decisions: setCollegePrepDesign(sheet, { student_id: '001234567' }) }
    expect(buildFerpaRelease(withId as DesignSheet)?.student_id).toBe('001234567')
  })
})

describe('FERPA release — selection', () => {
  it('defaults on from the student’s own answer, and off when they declined', () => {
    expect(getDocumentInclusions(collegePrepSheet()).ferpa_release).toBe(true)
    expect(
      getDocumentInclusions(collegePrepSheet({ ...COLLEGE_PREP_DETAILS, ferpa_release: false }))
        .ferpa_release,
    ).toBe(false)
  })

  it('never defaults on for an estate plan', () => {
    expect(defaultDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'married',
      matter_type: 'couple',
    }).ferpa_release).toBe(false)
  })

  it('adds the package alongside the college incapacity set', () => {
    const sheet = collegePrepSheet()
    const documents = deriveDocuments(
      'EP',
      [],
      false,
      false,
      false,
      null,
      getDocumentInclusions(sheet),
      'outright_to_spouse',
      getEstatePlanDesignSetup(sheet),
      [],
    )

    expect(documents.include_ferpa_release).toBe(true)

    const packages = deriveEstateGeneratorPackages({
      matter: { type: 'individual' },
      trust: null,
      documents,
      college_prep: buildCollegePrep(sheet),
    } as unknown as DraftPayload)

    expect(packages).toEqual([
      'college-financial-poa',
      'college-education-poa',
      'college-health-care-documents',
      'college-advance-directive',
      'ferpa-release',
    ])
  })

  it('is a package the node generator supports', () => {
    expect(isNodeEstatePackageSupported('ferpa-release')).toBe(true)
  })

  it('routes a missing FERPA field to the College Preparation Plan section', () => {
    expect(designTargetForMissingField('ferpa.school_name').sectionId)
      .toBe(DESIGN_SECTION_IDS.collegePlan)
    // Unknown ferpa.* paths degrade to the section rather than breaking the checklist.
    expect(designTargetForMissingField('ferpa.something_new').sectionId)
      .toBe(DESIGN_SECTION_IDS.collegePlan)
  })
})

describe('FERPA release — validation', () => {
  const context = (ferpa: Record<string, unknown>) =>
    buildNodeEstateContext({ data: { ferpa } as never, state: 'MA', root })

  it('requires named records when the release is not unlimited', () => {
    expect(conditionalMissingFieldsForPackage(
      'ferpa-release',
      context({ all_records: false, records: [] }),
    )).toEqual(['ferpa.records'])
  })

  it('asks for nothing extra when the student authorized every record', () => {
    expect(conditionalMissingFieldsForPackage(
      'ferpa-release',
      context({ all_records: true, records: [] }),
    )).toEqual([])
  })
})

describe('FERPA release — rendered document', () => {
  const example = JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-ferpa-release.json'), 'utf8'),
  ) as Record<string, unknown>

  const renderText = async (data: Record<string, unknown>) => {
    const result = await generateNodeEstatePackage({
      data, packageName: 'ferpa-release', state: 'MA', root, allowDraft: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files).toHaveLength(1)
    const xml = new PizZip(result.files[0].buffer).files['word/document.xml'].asText()
    return { xml, text: xml.replace(/<[^>]+>/g, '') }
  }

  it('renders the student, school, and every selected record category', async () => {
    const { text } = await renderText(example)

    expect(text).toContain('ROWAN DELGADO')
    expect(text).toContain('Northeastern University')
    expect(text).toContain('Boston, MA')
    expect(text).toContain('Grades and transcripts')
    expect(text).toContain('Bursar / tuition account')
    expect(text).toContain('Alma Delgado and Marcus Delgado, my parents')
  })

  it('leaves no unresolved template syntax or missing-field markers', async () => {
    const { text } = await renderText(example)

    expect(text).not.toMatch(/\{\{|\}\}|\{%|%\}/)
    expect(text).not.toContain('[[ MISSING:')
  })

  it('states the campus-treatment-records limit only when the health center is selected', async () => {
    const withHealthCenter = await renderText(example)
    expect(withHealthCenter.text).toContain('34 C.F.R. § 99.3')

    const withoutHealthCenter = await renderText({
      ...example,
      ferpa: {
        ...(example.ferpa as Record<string, unknown>),
        records: [{ key: 'grades', label: 'Grades and transcripts' }],
      },
    })
    expect(withoutHealthCenter.text).not.toContain('34 C.F.R. § 99.3')
  })

  it('collapses the category list into one sentence for an unlimited release', async () => {
    const { text } = await renderText({
      ...example,
      ferpa: { ...(example.ferpa as Record<string, unknown>), all_records: true },
    })

    expect(text).toContain('all of my education records, without limitation')
    expect(text).not.toContain('the following categories')
  })

  it('prints the student ID line only when there is one', async () => {
    const { text } = await renderText(example)
    expect(text).toContain('Student ID: 001234567')

    const withoutId = await renderText({
      ...example,
      ferpa: { ...(example.ferpa as Record<string, unknown>), student_id: '' },
    })
    expect(withoutId.text).toContain('Northeastern University')
    expect(withoutId.text).not.toContain('Student ID:')
  })

  it('recomputes the health-center flag rather than trusting a stale one', async () => {
    // A payload claiming the limit while naming no health-center record would
    // otherwise print a paragraph about records the release does not cover.
    const { text } = await renderText({
      ...example,
      ferpa: {
        ...(example.ferpa as Record<string, unknown>),
        includes_health_center: true,
        records: [{ key: 'grades', label: 'Grades and transcripts' }],
      },
    })

    expect(text).not.toContain('34 C.F.R. § 99.3')
  })

  it('drops the campus line when the school location is unknown', async () => {
    const { text } = await renderText({
      ...example,
      ferpa: { ...(example.ferpa as Record<string, unknown>), school_location: '' },
    })

    expect(text).toContain('Northeastern University')
    expect(text).not.toContain('Campus:')
  })

  it('keeps the section numbering static across both branches', async () => {
    for (const records of [
      [{ key: 'grades', label: 'Grades and transcripts' }],
      (example.ferpa as { records: unknown[] }).records,
    ]) {
      const { text } = await renderText({
        ...example,
        ferpa: { ...(example.ferpa as Record<string, unknown>), records },
      })
      expect(text).toContain('3. Purpose')
      expect(text).toContain('7. Institutional Forms')
    }
  })
})
