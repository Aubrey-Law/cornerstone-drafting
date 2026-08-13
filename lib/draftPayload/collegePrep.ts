/**
 * College Preparation Plan drafting payload.
 *
 * The student's document choices — how the durable power of attorney takes
 * effect and which powers it grants, limits and instructions for the health
 * care agent, the HIPAA release's scope and expiration, and the living-will
 * treatment decisions — live in `decisions.college_prep`. This module carries
 * the *drafted* answers onto the payload so the generator's college templates
 * can branch on them.
 *
 * "Discuss at the meeting" is a client deferral, not a drafted answer:
 * `collegePrepDraftingBlockers` stops drafting until the attorney replaces it,
 * so every deferral normalizes to null here rather than leaking a literal
 * "discuss" into a document.
 *
 * Estate sheets have none of this — `buildCollegePrep` returns null and the
 * college packages never select.
 */

import {
  getCollegePrepDesign,
  isCollegePrepDesignSheet,
  type CollegeDpoaPower,
  type CollegeHipaaCategory,
} from '@/lib/collegePrepDesign'
import {
  COLLEGE_DPOA_POWER_OPTIONS,
  COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS,
  DISCUSS_AT_MEETING,
} from '@/lib/collegePrepFields'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

export interface CollegeDpoaPowerCategory {
  key: CollegeDpoaPower
  label: string
}

export interface CollegeHipaaExcludedCategory {
  key: CollegeHipaaCategory
  label: string
}

export interface CollegeHipaaRecipientPerson {
  name: string
  relationship: string | null
  phone: string | null
}

export interface DraftPayloadCollegePrep {
  /** How the financial power of attorney takes effect; deferral → null. */
  dpoa_effective: 'immediately' | 'springing' | null
  dpoa_powers: CollegeDpoaPowerCategory[]
  /** Every power the questionnaire offers was granted. */
  dpoa_all_powers: boolean
  dpoa_withheld: string | null

  hcp_limits: string | null
  hcp_instructions: string | null

  hipaa_scope: 'all' | 'all_except' | null
  hipaa_excluded_categories: CollegeHipaaExcludedCategory[]
  hipaa_expiration: 'none' | 'date' | null
  hipaa_expiration_date: string | null
  hipaa_recipients: CollegeHipaaRecipientPerson[]
  excluded_people: string | null

  living_will_include: 'yes' | 'no' | null
  life_support: 'all_measures' | 'comfort_only' | 'trust_agent' | null
  cpr: 'yes' | 'no' | 'agent_decides' | null
  artificial_nutrition: 'yes' | 'no' | 'agent_decides' | null
  ventilation: 'yes' | 'no' | 'agent_decides' | null
  comfort_always: boolean
  organ_donation: 'any' | 'specific' | 'no' | null
  organ_donation_notes: string | null
}

const POWER_LABELS = new Map<string, string>(
  COLLEGE_DPOA_POWER_OPTIONS.map(option => [option.value, option.label]),
)

const HIPAA_CATEGORY_LABELS = new Map<string, string>(
  COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS.map(option => [option.value, option.label]),
)

function drafted<T extends string>(value: T | null): Exclude<T, typeof DISCUSS_AT_MEETING> | null {
  if (value === null || value === DISCUSS_AT_MEETING) return null
  return value as Exclude<T, typeof DISCUSS_AT_MEETING>
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function buildCollegePrep(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null | undefined,
): DraftPayloadCollegePrep | null {
  if (!designSheet || !isCollegePrepDesignSheet(designSheet)) return null

  const design = getCollegePrepDesign(designSheet)

  const powers = design.dpoa_powers.map(key => ({
    key,
    label: POWER_LABELS.get(key) ?? key,
  }))

  const excludedCategories = design.hipaa_excluded_categories.map(key => ({
    key,
    label: HIPAA_CATEGORY_LABELS.get(key) ?? key,
  }))

  const recipients = design.hipaa_recipients.map(recipient => ({
    name: recipient.name.trim(),
    relationship: trimmedOrNull(recipient.relationship),
    phone: trimmedOrNull(recipient.phone),
  }))

  return {
    dpoa_effective: drafted(design.dpoa_effective),
    dpoa_powers: powers,
    dpoa_all_powers: powers.length === COLLEGE_DPOA_POWER_OPTIONS.length,
    dpoa_withheld: design.dpoa_withheld,
    hcp_limits: design.hcp_limits,
    hcp_instructions: design.hcp_instructions,
    hipaa_scope: drafted(design.hipaa_scope),
    hipaa_excluded_categories: excludedCategories,
    hipaa_expiration: design.hipaa_expiration,
    hipaa_expiration_date: design.hipaa_expiration_date,
    hipaa_recipients: recipients,
    excluded_people: design.excluded_people,
    living_will_include: drafted(design.living_will_include),
    life_support: drafted(design.life_support),
    cpr: drafted(design.cpr),
    artificial_nutrition: drafted(design.artificial_nutrition),
    ventilation: drafted(design.ventilation),
    comfort_always: design.comfort_always === true,
    organ_donation: drafted(design.organ_donation),
    organ_donation_notes: design.organ_donation_notes,
  }
}
