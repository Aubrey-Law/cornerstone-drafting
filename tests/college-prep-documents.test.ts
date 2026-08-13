import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import { buildCollegePrep } from '@/lib/draftPayload/collegePrep'
import { buildCollegePrepSeedDecisions } from '@/lib/designSheet/seedCollegePrep'
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
import type { NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import type { DesignSheet } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

const COLLEGE_PREP_DETAILS = {
  school_name: 'Northeastern University',
  ferpa_release: false,
  dpoa_effective: 'springing',
  dpoa_powers: ['banking', 'tuition'],
  dpoa_withheld: 'making gifts of my property',
  hipaa_scope: 'all_except',
  hipaa_excluded_categories: ['mental_health'],
  hipaa_expiration: 'date',
  hipaa_expiration_date: '2030-06-30',
  living_will_include: 'yes',
  life_support: 'comfort_only',
  cpr: 'agent_decides',
  organ_donation: 'discuss',
}

function collegePrepIntake(details: Record<string, unknown>): IntakeSnapshot {
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

function selectedPackages(sheet: DesignSheet): string[] {
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
  return deriveEstateGeneratorPackages({
    matter: { type: 'individual' },
    trust: null,
    documents,
    college_prep: buildCollegePrep(sheet),
  } as unknown as DraftPayload)
}

describe('College prep documents — payload', () => {
  it('carries the drafted answers and normalizes deferrals to null', () => {
    const college = buildCollegePrep(collegePrepSheet())

    expect(college).toMatchObject({
      dpoa_effective: 'springing',
      dpoa_all_powers: false,
      dpoa_withheld: 'making gifts of my property',
      hipaa_scope: 'all_except',
      hipaa_expiration: 'date',
      living_will_include: 'yes',
      life_support: 'comfort_only',
      cpr: 'agent_decides',
      // "Discuss at the meeting" is a deferral, not a drafted answer.
      organ_donation: null,
    })
    expect(college?.dpoa_powers.map(power => power.key)).toEqual(['banking', 'tuition'])
    expect(college?.hipaa_excluded_categories.map(category => category.label))
      .toEqual(['Mental health / psychotherapy notes'])
  })

  it('detects a grant of every offered power', () => {
    const college = buildCollegePrep(collegePrepSheet({
      ...COLLEGE_PREP_DETAILS,
      dpoa_powers: [
        'banking', 'bills', 'tuition', 'financial_aid', 'student_loans', 'credit_cards',
        'taxes', 'housing', 'auto', 'insurance_claims', 'retain_attorney', 'citations',
        'investments', 'digital', 'employment', 'contracts',
      ],
    }))
    expect(college?.dpoa_all_powers).toBe(true)
  })

  it('is absent on an estate sheet', () => {
    expect(buildCollegePrep({ decisions: { document_inclusions: { will: true } } })).toBeNull()
    expect(buildCollegePrep(null)).toBeNull()
  })
})

describe('College prep documents — selection', () => {
  it('defaults the education POA on for the college track and off for estate plans', () => {
    expect(getDocumentInclusions(collegePrepSheet()).education_poa).toBe(true)
    expect(defaultDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'married',
      matter_type: 'couple',
    }).education_poa).toBe(false)
  })

  it('replaces the estate incapacity package with the college set', () => {
    const packages = selectedPackages(collegePrepSheet())

    expect(packages).toContain('college-financial-poa')
    expect(packages).toContain('college-education-poa')
    expect(packages).toContain('college-health-care-documents')
    expect(packages).toContain('college-advance-directive')
    expect(packages).not.toContain('incapacity-documents')
  })

  it('drops the advance directive when the student declined written instructions', () => {
    const packages = selectedPackages(collegePrepSheet({
      ...COLLEGE_PREP_DETAILS,
      living_will_include: 'no',
    }))

    expect(packages).toContain('college-health-care-documents')
    expect(packages).not.toContain('college-advance-directive')
  })

  it('keeps the estate incapacity package for estate matters', () => {
    const packages = deriveEstateGeneratorPackages({
      matter: { type: 'individual' },
      trust: null,
      documents: { include_dpoa: true, include_hcp: true, include_hipaa: true, include_ahd: true },
    } as unknown as DraftPayload)

    expect(packages).toContain('incapacity-documents')
    expect(packages.some(name => name.startsWith('college-'))).toBe(false)
  })

  it('is a package set the node generator supports', () => {
    for (const name of [
      'college-financial-poa',
      'college-education-poa',
      'college-health-care-documents',
      'college-advance-directive',
    ]) {
      expect(isNodeEstatePackageSupported(name)).toBe(true)
    }
  })

  it('routes missing college fields to the College Preparation Plan section', () => {
    expect(designTargetForMissingField('college.dpoa_effective').sectionId)
      .toBe(DESIGN_SECTION_IDS.collegePlan)
    // Unknown college.* paths degrade to the section rather than breaking the checklist.
    expect(designTargetForMissingField('college.something_new').sectionId)
      .toBe(DESIGN_SECTION_IDS.collegePlan)
  })
})

describe('College prep documents — validation', () => {
  const context = (college: Record<string, unknown>) =>
    buildNodeEstateContext({ data: { college } as never, state: 'MA', root })

  it('requires granted powers unless the student granted everything', () => {
    expect(conditionalMissingFieldsForPackage(
      'college-financial-poa',
      context({ dpoa_all_powers: false, dpoa_powers: [] }),
    )).toEqual(['college.dpoa_powers'])
    expect(conditionalMissingFieldsForPackage(
      'college-financial-poa',
      context({ dpoa_all_powers: true, dpoa_powers: [] }),
    )).toEqual([])
  })

  it('requires the expiration date for a dated HIPAA release', () => {
    expect(conditionalMissingFieldsForPackage(
      'college-health-care-documents',
      context({ hipaa_expiration: 'date', hipaa_expiration_date: '' }),
    )).toContain('college.hipaa_expiration_date')
    expect(conditionalMissingFieldsForPackage(
      'college-health-care-documents',
      context({ hipaa_expiration: 'none' }),
    )).toEqual([])
  })

  it('requires the withheld categories for an all-except release', () => {
    expect(conditionalMissingFieldsForPackage(
      'college-health-care-documents',
      context({ hipaa_scope: 'all_except', hipaa_excluded_categories: [] }),
    )).toContain('college.hipaa_excluded_categories')
  })

  it('requires the life-support instruction for the advance directive', () => {
    expect(conditionalMissingFieldsForPackage(
      'college-advance-directive',
      context({}),
    )).toEqual(['college.life_support'])
  })
})

describe('College prep documents — rendered output', () => {
  const example = JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-college-prep.json'), 'utf8'),
  ) as Record<string, unknown>

  const render = async (packageName: NodeEstatePackageName, data: Record<string, unknown> = example) => {
    const result = await generateNodeEstatePackage({
      data, packageName, state: 'MA', root, allowDraft: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    return result.files.map(file => ({
      name: file.name,
      text: new PizZip(file.buffer).files['word/document.xml'].asText().replace(/<[^>]+>/g, ''),
    }))
  }

  it('renders the springing financial POA with only the granted powers', async () => {
    const [poa] = await render('college-financial-poa')

    expect(poa.text).toContain('effective only upon my incapacity')
    expect(poa.text).not.toContain('effective immediately')
    expect(poa.text).toContain('Banking Powers')
    expect(poa.text).toContain('Tuition and Student Account Powers')
    // Powers the student did not grant stay out of the instrument.
    expect(poa.text).not.toContain('Tax Powers')
    expect(poa.text).not.toContain('Power to Acquire and Sell')
    expect(poa.text).toContain('making gifts of my property')
  })

  it('renders the full general grant when every power is granted', async () => {
    const college = example.college as Record<string, unknown>
    const [poa] = await render('college-financial-poa', {
      ...example,
      college: { ...college, dpoa_effective: 'immediately', dpoa_all_powers: true, dpoa_withheld: '' },
    })

    expect(poa.text).toContain('effective immediately')
    expect(poa.text).toContain('Tax Powers')
    expect(poa.text).toContain('Power to Acquire and Sell')
    expect(poa.text).not.toContain('EXCLUDED POWERS')
  })

  it('renders the HIPAA authorization with named recipients, withheld categories, and a dated expiration', async () => {
    const files = await render('college-health-care-documents')
    const hipaa = files.find(file => file.name.includes('hipaa'))!

    expect(hipaa.text).toContain('ALMA DELGADO, my Parent')
    expect(hipaa.text).toContain('Mental health / psychotherapy notes')
    expect(hipaa.text).toContain('terminate on June 30, 2030')
    expect(hipaa.text).toContain('Victor Delgado')
    // The FERPA release is its own package; education records stay out of the
    // HIPAA authorization.
    expect(hipaa.text).not.toContain('FERPA')
  })

  it('renders the comfort-only advance directive with the specific organ gift', async () => {
    const [directive] = await render('college-advance-directive')

    expect(directive.text).toContain('not be extended by life-sustaining procedures')
    expect(directive.text).toContain('decide about CPR')
    expect(directive.text).toContain('corneas and kidneys')
    expect(directive.text).not.toContain('[ do')
  })

  it('leaves no unresolved template syntax or missing-field markers in any package', async () => {
    for (const packageName of [
      'college-financial-poa',
      'college-education-poa',
      'college-health-care-documents',
      'college-advance-directive',
    ] as const) {
      for (const file of await render(packageName)) {
        expect(file.text, file.name).not.toMatch(/\{\{|\}\}|\{%|%\}/)
        expect(file.text, file.name).not.toContain('[[ MISSING:')
      }
    }
  })
})
