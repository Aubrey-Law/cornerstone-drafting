import { describe, expect, it } from 'vitest'

import {
  collegePrepDraftingBlockers,
  getCollegePrepDesign,
  getDesignPlanTrack,
  isCollegePrepDesignSheet,
  setCollegePrepDesign,
} from '@/lib/collegePrepDesign'
import {
  advanceDirectiveFromCollegePrep,
  buildCollegePrepSeedDecisions,
  buildCollegePrepSeedPayload,
  collegePrepDpoaSeed,
  collegePrepDesignFromIntake,
} from '@/lib/designSheet/seedCollegePrep'
import { buildIntakeSeedDecisions, buildIntakeSeedPayload } from '@/lib/designSheet/seedFromIntake'
import {
  defaultDocumentInclusions,
  getDocumentInclusions,
  getEstatePlanDesignSetup,
} from '@/lib/designSheetDocumentInclusions'
import { getDesignSheetDpoaProvisions } from '@/lib/designSheetDpoaProvisions'
import { getDesignSheetHealthcareProvisions } from '@/lib/designSheetHealthcareProvisions'
import { getAllDesignSectionNavItems } from '@/lib/designSheet/designSectionNav'
import { buildDesignSheetGroups } from '@/app/admin/drafting/[matterId]/design/designSectionCatalog'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import { computeDesignSheetReadiness } from '@/lib/designSheetReadiness'
import { deriveDocuments } from '@/lib/draftPayload/helpers'
import { deriveEstateGeneratorPackages } from '@/lib/estateGenerator/toGeneratorData'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import type { IntakeSnapshot } from '@/lib/queries'
import type { DesignSheet } from '@/types/database'

/** Answers as `client_intake.college_prep_details` stores them (no `college_` prefix). */
const COLLEGE_PREP_DETAILS = {
  school_name: 'Northeastern University',
  school_city: 'Boston',
  school_state: 'MA',
  move_in_date: '2026-08-28',
  studying_abroad: false,
  ferpa_release: true,
  ferpa_records: ['grades', 'billing'],
  ferpa_recipients: 'Both parents',
  dpoa_effective: 'immediately',
  dpoa_powers: ['banking', 'tuition', 'taxes', 'digital', 'contracts'],
  dpoa_withheld: 'No authority over my car.',
  hipaa_scope: 'all_except',
  hipaa_excluded_categories: ['mental_health'],
  hipaa_expiration: 'none',
  hipaa_recipients: [
    { id: '1', name: 'Alma Delgado', relationship: 'Mother', phone: '6175550143', email: '' },
  ],
  living_will_include: 'yes',
  life_support: 'comfort_only',
  cpr: 'no',
  organ_donation: 'any',
  concerns: 'Nervous about the school talking to my parents about grades.',
}

function collegePrepIntake(overrides: Partial<IntakeSnapshot> = {}): IntakeSnapshot {
  return {
    first_name: 'Rowan',
    last_name: 'Delgado',
    date_of_birth: '2007-04-02',
    email: 'rowan@example.com',
    phone: '(617) 555-0142',
    address_line1: '12 Elm Street',
    city: 'Newton',
    state: 'MA',
    zip: '02458',
    county: 'Middlesex',
    marital_status: 'single',
    intake_track: 'college_prep',
    college_prep_details: COLLEGE_PREP_DETAILS,
    plan_type: null,
    document_inclusions: null,
    ...overrides,
  } as unknown as IntakeSnapshot
}

/** A seeded college-prep sheet, as the drafting workspace would load it. */
function seededSheet(overrides: Partial<DesignSheet> = {}): DesignSheet {
  const intake = collegePrepIntake()
  return {
    client_name: 'Rowan Delgado',
    client_dob: '2007-04-02',
    client_email: 'rowan@example.com',
    marital_status: 'single',
    state: 'MA',
    matter_type: 'individual',
    plan_type: null,
    children: null,
    ...buildCollegePrepSeedPayload(intake),
    decisions: buildCollegePrepSeedDecisions(intake, null),
    ...overrides,
  } as unknown as DesignSheet
}

describe('college prep design sheet — seeding from intake', () => {
  it('marks the sheet as a college-prep plan and carries the answers over', () => {
    const decisions = buildIntakeSeedDecisions(collegePrepIntake(), null)
    const sheet = { decisions } as DesignSheet

    expect(getDesignPlanTrack(sheet)).toBe('college_prep')
    expect(isCollegePrepDesignSheet(sheet)).toBe(true)
    expect(getCollegePrepDesign(sheet)).toMatchObject({
      school_name: 'Northeastern University',
      move_in_date: '2026-08-28',
      ferpa_records: ['grades', 'billing'],
      hipaa_scope: 'all_except',
      living_will_include: 'yes',
    })
  })

  it('drops an answer the questionnaire no longer offers rather than drafting it', () => {
    const design = collegePrepDesignFromIntake(
      collegePrepIntake({
        college_prep_details: {
          ...COLLEGE_PREP_DETAILS,
          hipaa_scope: 'whatever_the_parents_ask_for',
          dpoa_powers: ['banking', 'time_travel'],
        },
      }),
    )

    expect(design.hipaa_scope).toBeNull()
    expect(design.dpoa_powers).toEqual(['banking'])
  })

  it('keeps the student as the client and leaves the estate plan structure empty', () => {
    const payload = buildIntakeSeedPayload(collegePrepIntake())

    expect(payload.client_name).toBe('Rowan Delgado')
    expect(payload.county).toBe('Middlesex')
    expect(payload.plan_type).toBeNull()
    expect(payload.is_joint).toBe(false)
  })

  it('maps the health answers onto the columns the health care documents read', () => {
    const payload = buildIntakeSeedPayload(collegePrepIntake())

    expect(payload.hcp_anatomical_gift).toBe('all')
    // Mental health was withheld, so the psychotherapy-notes line must not authorize.
    expect(payload.hipaa_psychotherapy_notes).toBe('do_not_authorize')
  })

  it('authorizes psychotherapy notes when the release is unlimited', () => {
    const payload = buildIntakeSeedPayload(
      collegePrepIntake({
        college_prep_details: { ...COLLEGE_PREP_DETAILS, hipaa_scope: 'all' },
      }),
    )

    expect(payload.hipaa_psychotherapy_notes).toBe('authorize')
  })

  it('leaves organ donation unanswered when the student deferred it', () => {
    const payload = buildIntakeSeedPayload(
      collegePrepIntake({
        college_prep_details: { ...COLLEGE_PREP_DETAILS, organ_donation: 'discuss' },
      }),
    )

    expect(payload.hcp_anatomical_gift).toBeNull()
  })

  it('records the FERPA gap and the unmapped powers in the drafting notes', () => {
    const notes = buildIntakeSeedPayload(collegePrepIntake()).goals_notes ?? ''

    expect(notes).toContain('Northeastern University')
    expect(notes).toContain('FERPA release requested')
    expect(notes).toContain('Signing contracts')
  })

  it('warns that a springing power of attorney needs hand-drafting', () => {
    const notes = buildIntakeSeedPayload(
      collegePrepIntake({
        college_prep_details: { ...COLLEGE_PREP_DETAILS, dpoa_effective: 'springing' },
      }),
    ).goals_notes ?? ''

    expect(notes).toContain('springing')
  })
})

describe('college prep design sheet — provision seeds', () => {
  it('places each student-facing power in the statutory power that contains it', () => {
    const seed = collegePrepDpoaSeed(collegePrepDesignFromIntake(collegePrepIntake()))

    expect(seed.basic_powers.banking).toBe(true)
    expect(seed.basic_powers.personal_family_maintenance).toBe(true)
    expect(seed.basic_powers.tax_matters).toBe(true)
    expect(seed.basic_powers.real_property).toBe(false)
    expect(seed.all_basic_powers).toBe(false)
    expect(seed.power_digital_assets).toBe(true)
    expect(seed.power_529_plans).toBe(true)
    expect(seed.unmapped).toEqual(['contracts'])
  })

  it('writes those powers into the DPOA provisions the section already edits', () => {
    const provisions = getDesignSheetDpoaProvisions(seededSheet())

    expect(provisions.basic_powers.banking).toBe(true)
    expect(provisions.power_digital_assets).toBe(true)
    expect(provisions.allow_gifts).toBe(false)
    expect(provisions.include_trust_powers).toBe(false)
    expect(provisions.additional_limitations).toBe('No authority over my car.')
  })

  it('translates the life-support answer into the advance directive vocabulary', () => {
    const design = collegePrepDesignFromIntake(collegePrepIntake())
    expect(advanceDirectiveFromCollegePrep(design)).toBe('do_not_prolong_life')

    expect(
      advanceDirectiveFromCollegePrep(
        collegePrepDesignFromIntake(
          collegePrepIntake({
            college_prep_details: { ...COLLEGE_PREP_DETAILS, life_support: 'all_measures' },
          }),
        ),
      ),
    ).toBe('prolong_life')
  })

  it('records no written instruction when the student leaves it to the agent', () => {
    expect(
      advanceDirectiveFromCollegePrep(
        collegePrepDesignFromIntake(
          collegePrepIntake({
            college_prep_details: { ...COLLEGE_PREP_DETAILS, life_support: 'trust_agent' },
          }),
        ),
      ),
    ).toBeNull()
  })

  it('clears the health care readiness prompts the student already answered', () => {
    const provisions = getDesignSheetHealthcareProvisions(seededSheet())

    expect(provisions.client_anatomical_gift).toBe('yes')
    expect(provisions.client_advance_directive).toBe('do_not_prolong_life')
  })
})

describe('college prep design sheet — document set', () => {
  it('includes the four student documents and nothing else', () => {
    const inclusions = getDocumentInclusions(seededSheet())

    expect(inclusions).toMatchObject({
      trust: false,
      will: false,
      deed: false,
      dpoa: true,
      healthcare: true,
      young_adult_estate_plan: false,
      spouse_docs: false,
    })
  })

  it('defaults that way from the track alone, without a seeded inclusion blob', () => {
    const inclusions = defaultDocumentInclusions({
      plan_type: null,
      marital_status: 'single',
      matter_type: 'individual',
      decisions: { plan_track: 'college_prep' },
    })

    expect(inclusions.trust).toBe(false)
    expect(inclusions.will).toBe(false)
    expect(inclusions.dpoa).toBe(true)
  })

  it('leaves the estate track defaults alone', () => {
    const inclusions = defaultDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'married',
      matter_type: 'couple',
    })

    expect(inclusions.trust).toBe(true)
    expect(inclusions.will).toBe(true)
    expect(inclusions.spouse_docs).toBe(true)
  })

  it('switches off the estate-plan extras that assume a full plan', () => {
    const setup = getEstatePlanDesignSetup(seededSheet())

    expect(setup.ancillary_documents.estate_plan_summary).toBe(false)
    expect(setup.ancillary_documents.estate_plan_signing_guide).toBe(false)
    expect(setup.ancillary_documents.fiduciary_role_guide).toBe(false)
    expect(setup.living_will).toBe(true)
  })

  it('drops the living will only when the student declined it', () => {
    const declined = seededSheet({
      decisions: buildCollegePrepSeedDecisions(
        collegePrepIntake({
          college_prep_details: { ...COLLEGE_PREP_DETAILS, living_will_include: 'no' },
        }),
        null,
      ),
    })

    expect(getEstatePlanDesignSetup(declined).living_will).toBe(false)
  })

  it('routes the plan to the incapacity package and no estate packages', () => {
    const sheet = seededSheet()
    const documents = deriveDocuments(
      'EP',
      [],
      false,
      false,
      false,
      sheet.plan_type,
      getDocumentInclusions(sheet),
      'outright_to_spouse',
      getEstatePlanDesignSetup(sheet),
      [],
    )

    expect(documents).toMatchObject({
      include_trust: false,
      include_pour_over_will: false,
      include_simple_will: false,
      include_dpoa: true,
      include_hcp: true,
      include_hipaa: true,
      include_ahd: true,
      include_ppm: false,
      include_estate_plan_summary: false,
      spouse_docs: false,
    })

    // deriveEstateGeneratorPackages reads only these three fields.
    const packages = deriveEstateGeneratorPackages({
      matter: { type: 'individual' },
      trust: null,
      documents,
    } as unknown as DraftPayload)

    expect(packages).toEqual(['incapacity-documents'])
  })
})

describe('college prep design sheet — sections and readiness', () => {
  const navArgs = {
    intakeSnapshot: null,
    documentInclusions: getDocumentInclusions(seededSheet()),
    planType: null,
  }

  it('shows the student sections and drops the trust, will, and asset sections', () => {
    const ids = getAllDesignSectionNavItems({ ...navArgs, planTrack: 'college_prep' as const })
      .map(item => item.id)

    expect(ids).toEqual([
      DESIGN_SECTION_IDS.intakeReview,
      DESIGN_SECTION_IDS.clientInformation,
      DESIGN_SECTION_IDS.fiduciaries,
      DESIGN_SECTION_IDS.collegePlan,
      DESIGN_SECTION_IDS.financialPoa,
      DESIGN_SECTION_IDS.healthcareDirectives,
      DESIGN_SECTION_IDS.attorneyNotes,
    ])
  })

  it('keeps the estate section list untouched', () => {
    const ids = getAllDesignSectionNavItems({
      intakeSnapshot: null,
      documentInclusions: defaultDocumentInclusions({
        plan_type: 'pour_over',
        marital_status: 'married',
        matter_type: 'couple',
      }),
      planType: 'pour_over',
    }).map(item => item.id)

    expect(ids).toContain(DESIGN_SECTION_IDS.trustDetails)
    expect(ids).toContain(DESIGN_SECTION_IDS.willDetails)
    expect(ids).not.toContain(DESIGN_SECTION_IDS.collegePlan)
  })

  it('offers only the tabs the plan can use, on either track', () => {
    const collegeTabs = buildDesignSheetGroups([], 'college_prep').map(group => group.id)
    const estateTabs = buildDesignSheetGroups([], 'estate').map(group => group.id)

    expect(collegeTabs).toEqual([
      'facts',
      'college-plan',
      'fiduciaries',
      'powers-of-attorney',
      'healthcare',
      'notes',
    ])
    // The estate sheet keeps its trust tab (the attorney can switch a trust back
    // on) and never shows the college-prep one.
    expect(estateTabs).toContain('trust')
    expect(estateTabs).not.toContain('college-plan')
  })

  it('never asks a college-prep sheet for a plan type', () => {
    const readiness = computeDesignSheetReadiness({
      sheet: seededSheet(),
      matter: { has_minor_children: false },
      isLP: false,
      lpData: null,
    })

    expect(readiness.blockers.map(item => item.label)).not.toContain('plan type')
  })

  it('blocks on the answers the student deferred to the meeting', () => {
    const deferred = seededSheet({
      decisions: buildCollegePrepSeedDecisions(
        collegePrepIntake({
          college_prep_details: {
            ...COLLEGE_PREP_DETAILS,
            dpoa_effective: 'discuss',
            hipaa_scope: 'discuss',
            hipaa_expiration: null,
            living_will_include: 'discuss',
          },
        }),
        null,
      ),
    })

    expect(collegePrepDraftingBlockers(deferred).map(item => item.label)).toEqual([
      'power of attorney effective date',
      'HIPAA release scope',
      'HIPAA expiration',
      'living will decision',
    ])

    const readiness = computeDesignSheetReadiness({
      sheet: deferred,
      matter: { has_minor_children: false },
      isLP: false,
      lpData: null,
    })
    const collegeBlockers = readiness.blocking.filter(
      item => item.sectionId === DESIGN_SECTION_IDS.collegePlan,
    )

    expect(collegeBlockers).toHaveLength(4)
    expect(collegeBlockers[0].targetField).toBe('college_prep.dpoa_effective')
  })

  it('clears once the attorney resolves them in the design sheet', () => {
    const resolved = seededSheet()
    expect(collegePrepDraftingBlockers(resolved)).toEqual([])

    const readiness = computeDesignSheetReadiness({
      sheet: resolved,
      matter: { has_minor_children: false },
      isLP: false,
      lpData: null,
    })

    expect(
      readiness.blocking.filter(item => item.sectionId === DESIGN_SECTION_IDS.collegePlan),
    ).toEqual([])
  })

  it('still requires a HIPAA expiration date when one was chosen', () => {
    const sheet = seededSheet()
    const withDateChoice = {
      ...sheet,
      decisions: setCollegePrepDesign(sheet, { hipaa_expiration: 'date' }),
    } as DesignSheet

    expect(collegePrepDraftingBlockers(withDateChoice).map(item => item.label)).toContain(
      'HIPAA expiration date',
    )
  })

  it('keeps an attorney edit on the sheet and stays on the college-prep track', () => {
    const sheet = seededSheet()
    const edited = {
      ...sheet,
      decisions: setCollegePrepDesign(sheet, { dpoa_effective: 'springing' }),
    } as DesignSheet

    expect(getCollegePrepDesign(edited).dpoa_effective).toBe('springing')
    expect(getCollegePrepDesign(edited).school_name).toBe('Northeastern University')
    expect(isCollegePrepDesignSheet(edited)).toBe(true)
  })
})
