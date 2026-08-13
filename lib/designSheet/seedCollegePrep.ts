/**
 * Seed a design sheet from a College Preparation Plan intake.
 *
 * The student's identity, address, and agent nominations already flow through
 * `buildIntakeSeedPayload` — on this track the student *is* the client, so the
 * core columns need no special handling. What this module adds is the part the
 * estate seed has no vocabulary for: the college-prep answers themselves, the
 * document set they imply, and the two answers that map onto real design-sheet
 * columns (anatomical gift, psychotherapy notes) rather than into the JSONB.
 */

import {
  getCollegePrepDesign,
  type CollegeDpoaPower,
  type CollegePrepDesign,
} from '@/lib/collegePrepDesign'
import {
  COLLEGE_DPOA_POWER_OPTIONS,
  DISCUSS_AT_MEETING,
} from '@/lib/collegePrepFields'
import {
  DPOA_BASIC_POWER_KEYS,
  setDesignSheetDpoaProvisions,
  type DpoaBasicPowerKey,
} from '@/lib/designSheetDpoaProvisions'
import {
  setDesignSheetHealthcareProvisions,
  type AdvanceDirectiveChoice,
} from '@/lib/designSheetHealthcareProvisions'
import type { DesignSheet, DesignSheetUpdate } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize the stored `college_prep_details` blob through the same readers the
 * design sheet uses, so an unknown or malformed answer never reaches drafting.
 */
export function collegePrepDesignFromIntake(intake: IntakeSnapshot): CollegePrepDesign {
  const details = isRecord(intake.college_prep_details) ? intake.college_prep_details : {}
  return getCollegePrepDesign({ decisions: { college_prep: details } })
}

/**
 * Anatomical gift, in the health-care-proxy column's vocabulary. "Discuss at
 * the meeting" stays null: the attorney answers it in the design sheet, and a
 * guess here would silently become a drafted instruction.
 */
export function anatomicalGiftFromCollegePrep(
  design: CollegePrepDesign,
): DesignSheet['hcp_anatomical_gift'] {
  switch (design.organ_donation) {
    case 'any':
      return 'all'
    case 'specific':
      return 'specified'
    case 'no':
      return 'none'
    default:
      return null
  }
}

/**
 * Psychotherapy notes carry their own HIPAA authorization line. The student
 * withholds them only by naming mental health as a withheld category, so an
 * unlimited release authorizes them and a carve-out that does not name mental
 * health leaves them authorized too.
 */
export function psychotherapyNotesFromCollegePrep(
  design: CollegePrepDesign,
): DesignSheet['hipaa_psychotherapy_notes'] {
  if (design.hipaa_scope === 'all') return 'authorize'
  if (design.hipaa_scope === 'all_except') {
    return design.hipaa_excluded_categories.includes('mental_health')
      ? 'do_not_authorize'
      : 'authorize'
  }
  return null
}

/**
 * The questionnaire asks about powers in a student's vocabulary ("tuition,
 * bursar, and student accounts"); the durable power of attorney grants them in
 * the statutory one. This table places each answer in the statutory power that
 * contains it, as a starting position the attorney reviews in the Financial
 * Power of Attorney section — it is a seed, not a final grant.
 *
 * Two answers have no statutory bucket and are handled separately: digital
 * account access is its own switch on the template, and "signing contracts"
 * spans every category, so it is raised in the drafting notes instead of being
 * assigned to one.
 */
const COLLEGE_DPOA_POWER_MAP: Record<CollegeDpoaPower, DpoaBasicPowerKey | null> = {
  banking: 'banking',
  bills: 'personal_family_maintenance',
  tuition: 'personal_family_maintenance',
  financial_aid: 'government_benefits',
  student_loans: 'banking',
  credit_cards: 'banking',
  taxes: 'tax_matters',
  housing: 'real_property',
  auto: 'tangible_personal_property',
  insurance_claims: 'insurance_annuity',
  retain_attorney: 'claims_litigation',
  citations: 'claims_litigation',
  investments: 'stocks_bonds',
  digital: null,
  employment: 'personal_family_maintenance',
  contracts: null,
}

export interface CollegePrepDpoaSeed {
  basic_powers: Record<DpoaBasicPowerKey, boolean>
  all_basic_powers: boolean
  power_digital_assets: boolean
  power_529_plans: boolean
  /** Selected powers with no statutory equivalent, for the drafting notes. */
  unmapped: CollegeDpoaPower[]
}

export function collegePrepDpoaSeed(design: CollegePrepDesign): CollegePrepDpoaSeed {
  const basic_powers = Object.fromEntries(
    DPOA_BASIC_POWER_KEYS.map(key => [key, false]),
  ) as Record<DpoaBasicPowerKey, boolean>
  const unmapped: CollegeDpoaPower[] = []

  for (const power of design.dpoa_powers) {
    const mapped = COLLEGE_DPOA_POWER_MAP[power]
    if (mapped) basic_powers[mapped] = true
    else if (power !== 'digital') unmapped.push(power)
  }

  return {
    basic_powers,
    all_basic_powers: DPOA_BASIC_POWER_KEYS.every(key => basic_powers[key]),
    power_digital_assets: design.dpoa_powers.includes('digital'),
    // The whole point of this plan is the tuition and financial-aid offices.
    power_529_plans:
      design.dpoa_powers.includes('tuition') || design.dpoa_powers.includes('financial_aid'),
    unmapped,
  }
}

/**
 * The living will's headline instruction, in the advance-directive vocabulary
 * the health care documents already use. "Leave it to my health care agent" is
 * deliberately not mapped: it is the absence of a written instruction, and
 * recording it as one would reverse the student's choice.
 */
export function advanceDirectiveFromCollegePrep(
  design: CollegePrepDesign,
): AdvanceDirectiveChoice | null {
  switch (design.life_support) {
    case 'all_measures':
      return 'prolong_life'
    case 'comfort_only':
      return 'do_not_prolong_life'
    default:
      return null
  }
}

/** Column values the college-prep answers imply, layered over the estate seed. */
export function buildCollegePrepSeedPayload(intake: IntakeSnapshot): DesignSheetUpdate {
  const design = collegePrepDesignFromIntake(intake)

  return {
    // No trust, no will, no deed on this track — leave the plan-structure
    // columns empty rather than seeding an estate plan the student is not buying.
    plan_type: null,
    is_joint: false,
    hcp_anatomical_gift: anatomicalGiftFromCollegePrep(design),
    hcp_anatomical_specified:
      design.organ_donation === 'specific' ? design.organ_donation_notes : null,
    hipaa_psychotherapy_notes: psychotherapyNotesFromCollegePrep(design),
    goals_notes: collegePrepSeedNotes(design),
    concerns: design.concerns,
  }
}

/**
 * Decisions patch for a college-prep sheet: the answers, the track marker, and
 * the document set. Ancillary estate documents are switched off explicitly —
 * their defaults key off "is there a trust", which would otherwise leave the
 * summary and signing guide on for a four-document package.
 */
export function buildCollegePrepSeedDecisions(
  intake: IntakeSnapshot,
  currentDecisions: DesignSheet['decisions'] | null | undefined,
): Record<string, unknown> {
  const design = collegePrepDesignFromIntake(intake)
  const base = isRecord(currentDecisions) ? currentDecisions : {}
  const currentInclusions = isRecord(base.document_inclusions) ? base.document_inclusions : {}
  const dpoaSeed = collegePrepDpoaSeed(design)

  // Layer the provision namespaces through their own setters so this seed never
  // has to know their internal shape or defaults.
  const withDpoa = setDesignSheetDpoaProvisions(
    { decisions: base, dpoa_coagent_manner: null },
    {
      basic_powers: dpoaSeed.basic_powers,
      all_basic_powers: dpoaSeed.all_basic_powers,
      power_digital_assets: dpoaSeed.power_digital_assets,
      power_529_plans: dpoaSeed.power_529_plans,
      additional_limitations: design.dpoa_withheld,
      // A student's plan grants no gifting or trust powers unless the attorney
      // adds them; the point is access to accounts, not estate planning.
      allow_gifts: false,
      include_trust_powers: false,
    },
  )

  const withHealthcare = setDesignSheetHealthcareProvisions(
    { decisions: withDpoa, hcp_anatomical_gift: anatomicalGiftFromCollegePrep(design) },
    {
      client_advance_directive: advanceDirectiveFromCollegePrep(design),
      // The HIPAA authorization names the people the student listed, not a
      // fiduciary class — the recipients are usually wider than the proxy.
      hipaa_list_fiduciaries_by_name: 'by_name',
      hipaa_include_poa: true,
    },
  )

  return {
    ...withHealthcare,
    plan_track: 'college_prep',
    college_prep: design,
    document_inclusions: {
      ...currentInclusions,
      trust: false,
      will: false,
      deed: false,
      dpoa: true,
      healthcare: true,
      young_adult_estate_plan: false,
      spouse_docs: false,
    },
    estate_plan_design: {
      health_care_proxy: true,
      hipaa_authorization: true,
      // "Discuss at the meeting" leaves the living will in the package: dropping
      // a document the client has not declined is the harder mistake to catch.
      living_will: design.living_will_include !== 'no',
      signing_type: 'undecided',
      ancillary_documents: {
        certificate_of_trust: false,
        assignment_of_personal_property: false,
        funding_instructions: false,
        funding_recommendation: false,
        homestead_trustee: false,
        trust_summary: false,
        estate_plan_summary: false,
        estate_plan_signing_guide: false,
        successor_trustee_checklist: false,
        fiduciary_role_guide: false,
        flowchart: false,
        include_asset_spreadsheet: false,
      },
    },
  }
}

/** Drafting notes the attorney needs but no document field carries. */
export function collegePrepSeedNotes(design: CollegePrepDesign): string | null {
  const lines: string[] = []

  if (design.school_name) {
    const campus = [design.school_city, design.school_state].filter(Boolean).join(', ')
    lines.push(`School: ${design.school_name}${campus ? ` (${campus})` : ''}`)
  }
  if (design.move_in_date) lines.push(`Move-in / orientation: ${design.move_in_date}`)
  if (design.studying_abroad) {
    lines.push(`Studying abroad${design.abroad_country ? `: ${design.abroad_country}` : ''}`)
  }
  if (design.ferpa_release) {
    const records = design.ferpa_records.length
    lines.push(
      `FERPA release requested${records > 0 ? ` (${records} record type${records === 1 ? '' : 's'})` : ''}` +
        ' — no generator package covers it; draft from the firm form and the school portal.',
    )
  }
  if (design.dpoa_effective === DISCUSS_AT_MEETING) {
    lines.push('Student deferred the DPOA effective date to the meeting.')
  }
  if (design.dpoa_effective === 'springing') {
    lines.push(
      'DPOA is springing — the generator template drafts an immediately effective power, so the' +
        ' incapacity-determination language has to be added by hand.',
    )
  }
  const unmapped = collegePrepDpoaSeed(design).unmapped
  if (unmapped.length > 0) {
    const labels = unmapped.map(
      power => COLLEGE_DPOA_POWER_OPTIONS.find(option => option.value === power)?.label ?? power,
    )
    lines.push(`DPOA powers with no statutory category — confirm coverage: ${labels.join('; ')}.`)
  }
  if (design.hipaa_different_scope) {
    lines.push(`Per-person HIPAA scope: ${design.hipaa_different_scope}`)
  }
  if (design.family_circumstances) lines.push(`Family circumstances: ${design.family_circumstances}`)
  if (design.excluded_people) lines.push(`Must NOT receive access: ${design.excluded_people}`)

  return lines.length > 0 ? lines.join('\n') : null
}
