import type { DesignSheet, StaggeredTier } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type TrustNameDateStyle = 'ua_dated' | 'dated_only'

export type InitialTrusteeNomination =
  | 'grantor'
  | 'grantor_and_spouse'
  | 'single_initial_trustee'
  | 'client'
  | 'spouse'
  | 'client_and_spouse'

export type TrustCoTrusteeDecision =
  | 'joint_majority'
  | 'independent'
  | 'omit'
  | 'settlor_separate_others_joint'

export type TrusteeCompensation =
  | 'prevailing_corporate'
  | 'prevailing_professional'
  | 'reasonable'
  | 'based_on_trustee_type'
  | 'none'

export type SuccessorTrusteeVacancy =
  | 'income_beneficiaries_any'
  | 'income_beneficiaries_professional'
  | 'resigning_neutral'
  | 'resigning_professional'
  | 'settlor_or_court'

export type ResidualBeneficiaryMethod = 'outright' | 'staggered' | 'trust_for_life' | 'custom'

export const RESIDUAL_BENEFICIARY_METHODS: readonly ResidualBeneficiaryMethod[] = [
  'outright',
  'staggered',
  'trust_for_life',
  'custom',
]

/**
 * Coerce a stored residual beneficiary method to the canonical union, or null when
 * nothing usable is set. Null must never be treated as a default — callers surface
 * it as a decision the attorney still owes.
 *
 * `trust-for-life` is accepted because the design sheet's option value is hyphenated
 * while the union is underscored, and the `as ResidualBeneficiaryMethod` cast at the
 * call site hides the mismatch from the compiler. Normalising here keeps that from
 * reading as an invalid value; the option value itself still needs correcting.
 */
export function normalizeResidualBeneficiaryMethod(value: unknown): ResidualBeneficiaryMethod | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/-/g, '_')
  return (RESIDUAL_BENEFICIARY_METHODS as readonly string[]).includes(normalized)
    ? normalized as ResidualBeneficiaryMethod
    : null
}

/** The method the UI, readiness and the generator all resolve to, from either home. */
export function resolveResidualBeneficiaryMethod(
  sheet: Pick<DesignSheet, 'decisions' | 'distribution_method'>,
): ResidualBeneficiaryMethod | null {
  return normalizeResidualBeneficiaryMethod(getTrustDetails(sheet).residual_beneficiary_method)
    ?? normalizeResidualBeneficiaryMethod(sheet.distribution_method)
}

export type ResiduaryAfterDeath =
  | 'descendants_outright_per_stirpes'
  | 'descendants_shares_outright_children_trusts_others'
  | 'descendants_shares_all_trusts'
  | 'named_beneficiaries_separate_terms'

export type RepresentationType = 'by_representation' | 'per_stirpes' | 'per_capita_each_generation'

export interface TrustNameFormat {
  date_style: TrustNameDateStyle
  append_amendments: boolean
}

export interface TrustDetailsProvisions {
  initial_trustee_nomination: InitialTrusteeNomination | null
  spouse_initial_trustee_nomination: InitialTrusteeNomination | null
  co_trustee_decision: TrustCoTrusteeDecision | null
  trustee_compensation: TrusteeCompensation | null
  protect_us_trust_status: boolean
  allow_special_trustee: boolean
  special_trustee_instructions: string | null
  power_529_plans: boolean
  power_farms_ranches: boolean
  power_closely_held_businesses: boolean
  power_professional_corporations: boolean
  subchapter_s_provisions: boolean
  allow_trustee_change_situs: boolean
  successor_trustee_vacancy: SuccessorTrusteeVacancy | null
  residual_beneficiary_method: ResidualBeneficiaryMethod | null
  residuary_after_death: ResiduaryAfterDeath | null
  include_common_trust_for_children: boolean
  special_distributions_age: number | null
  hold_distributions_for_young_beneficiaries: boolean
  include_substance_abuse: boolean
  include_creditor_divorce_provisions: boolean
  include_contingent_snt: boolean
  allow_distributions_to_dependents_if_incapacitated: boolean
  include_no_contest_clause: boolean
  name_people_in_no_contest_clause: boolean
  require_mandatory_arbitration: boolean
  prorate_estate_taxes: boolean
  representation_type: RepresentationType | null
  survivorship_requirement_days: number | null
  include_discretionary_distribution_definition: boolean
  include_education_expenses_definition: boolean
  include_arts_education: boolean
  include_vocational_training: boolean
  include_homeschooling: boolean
  include_disappearance_definition: boolean
}

const DEFAULT_TRUST_NAME_FORMAT: TrustNameFormat = {
  date_style: 'ua_dated',
  append_amendments: false,
}

const DEFAULT_TRUST_DETAILS: TrustDetailsProvisions = {
  initial_trustee_nomination: 'grantor',
  spouse_initial_trustee_nomination: 'spouse',
  co_trustee_decision: 'joint_majority',
  trustee_compensation: 'reasonable',
  protect_us_trust_status: false,
  allow_special_trustee: false,
  special_trustee_instructions: null,
  power_529_plans: false,
  power_farms_ranches: false,
  power_closely_held_businesses: false,
  power_professional_corporations: false,
  subchapter_s_provisions: false,
  allow_trustee_change_situs: false,
  successor_trustee_vacancy: null,
  residual_beneficiary_method: null,
  residuary_after_death: null,
  include_common_trust_for_children: false,
  special_distributions_age: null,
  hold_distributions_for_young_beneficiaries: false,
  include_substance_abuse: false,
  include_creditor_divorce_provisions: false,
  include_contingent_snt: false,
  allow_distributions_to_dependents_if_incapacitated: false,
  include_no_contest_clause: false,
  name_people_in_no_contest_clause: false,
  require_mandatory_arbitration: false,
  prorate_estate_taxes: false,
  representation_type: null,
  survivorship_requirement_days: null,
  include_discretionary_distribution_definition: false,
  include_education_expenses_definition: false,
  include_arts_education: false,
  include_vocational_training: false,
  include_homeschooling: false,
  include_disappearance_definition: false,
}

function trustDetailsRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.trust_details
  return isRecord(raw) ? raw : {}
}

function trustNameFormatRaw(sheet: Pick<DesignSheet, 'decisions'>, scope: 'client' | 'spouse'): Record<string, unknown> {
  const raw = trustDetailsRaw(sheet)
  const formats = isRecord(raw.trust_name_format) ? raw.trust_name_format : {}
  const scoped = formats[scope]
  return isRecord(scoped) ? scoped : {}
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof raw[key] === 'boolean' ? raw[key] : fallback
}

function readString<T extends string>(raw: Record<string, unknown>, key: string, fallback: T | null): T | null {
  const value = raw[key]
  return typeof value === 'string' ? (value as T) : fallback
}

function readNumber(raw: Record<string, unknown>, key: string, fallback: number | null): number | null {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function getTrustNameFormat(
  sheet: Pick<DesignSheet, 'decisions'>,
  scope: 'client' | 'spouse' = 'client',
): TrustNameFormat {
  const raw = trustNameFormatRaw(sheet, scope)
  const dateStyle = raw.date_style === 'dated_only' ? 'dated_only' : 'ua_dated'
  return {
    date_style: dateStyle,
    append_amendments: readBoolean(raw, 'append_amendments', DEFAULT_TRUST_NAME_FORMAT.append_amendments),
  }
}

export function setTrustNameFormat(
  sheet: Pick<DesignSheet, 'decisions'>,
  scope: 'client' | 'spouse',
  patch: Partial<TrustNameFormat>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = trustDetailsRaw(sheet)
  const formats = isRecord(raw.trust_name_format) ? { ...raw.trust_name_format } : {}
  const current = getTrustNameFormat(sheet, scope)

  return {
    ...decisions,
    trust_details: {
      ...raw,
      trust_name_format: {
        ...formats,
        [scope]: { ...current, ...patch },
      },
    },
  }
}

export function getTrustDetails(sheet: Pick<DesignSheet, 'decisions'>): TrustDetailsProvisions {
  const raw = trustDetailsRaw(sheet)
  return {
    initial_trustee_nomination: readString(raw, 'initial_trustee_nomination', DEFAULT_TRUST_DETAILS.initial_trustee_nomination),
    spouse_initial_trustee_nomination: readString(
      raw,
      'spouse_initial_trustee_nomination',
      DEFAULT_TRUST_DETAILS.spouse_initial_trustee_nomination,
    ),
    co_trustee_decision: readString(raw, 'co_trustee_decision', DEFAULT_TRUST_DETAILS.co_trustee_decision),
    trustee_compensation: readString(raw, 'trustee_compensation', DEFAULT_TRUST_DETAILS.trustee_compensation),
    protect_us_trust_status: readBoolean(raw, 'protect_us_trust_status', DEFAULT_TRUST_DETAILS.protect_us_trust_status),
    allow_special_trustee: readBoolean(raw, 'allow_special_trustee', DEFAULT_TRUST_DETAILS.allow_special_trustee),
    special_trustee_instructions: readString(raw, 'special_trustee_instructions', DEFAULT_TRUST_DETAILS.special_trustee_instructions),
    power_529_plans: readBoolean(raw, 'power_529_plans', DEFAULT_TRUST_DETAILS.power_529_plans),
    power_farms_ranches: readBoolean(raw, 'power_farms_ranches', DEFAULT_TRUST_DETAILS.power_farms_ranches),
    power_closely_held_businesses: readBoolean(raw, 'power_closely_held_businesses', DEFAULT_TRUST_DETAILS.power_closely_held_businesses),
    power_professional_corporations: readBoolean(raw, 'power_professional_corporations', DEFAULT_TRUST_DETAILS.power_professional_corporations),
    subchapter_s_provisions: readBoolean(raw, 'subchapter_s_provisions', DEFAULT_TRUST_DETAILS.subchapter_s_provisions),
    allow_trustee_change_situs: readBoolean(raw, 'allow_trustee_change_situs', DEFAULT_TRUST_DETAILS.allow_trustee_change_situs),
    successor_trustee_vacancy: readString(raw, 'successor_trustee_vacancy', DEFAULT_TRUST_DETAILS.successor_trustee_vacancy),
    residual_beneficiary_method: readString(raw, 'residual_beneficiary_method', DEFAULT_TRUST_DETAILS.residual_beneficiary_method),
    residuary_after_death: readString(raw, 'residuary_after_death', DEFAULT_TRUST_DETAILS.residuary_after_death),
    include_common_trust_for_children: readBoolean(raw, 'include_common_trust_for_children', DEFAULT_TRUST_DETAILS.include_common_trust_for_children),
    special_distributions_age: readNumber(raw, 'special_distributions_age', DEFAULT_TRUST_DETAILS.special_distributions_age),
    hold_distributions_for_young_beneficiaries: readBoolean(raw, 'hold_distributions_for_young_beneficiaries', DEFAULT_TRUST_DETAILS.hold_distributions_for_young_beneficiaries),
    include_substance_abuse: readBoolean(raw, 'include_substance_abuse', DEFAULT_TRUST_DETAILS.include_substance_abuse),
    include_creditor_divorce_provisions: readBoolean(raw, 'include_creditor_divorce_provisions', DEFAULT_TRUST_DETAILS.include_creditor_divorce_provisions),
    include_contingent_snt: readBoolean(raw, 'include_contingent_snt', DEFAULT_TRUST_DETAILS.include_contingent_snt),
    allow_distributions_to_dependents_if_incapacitated: readBoolean(
      raw,
      'allow_distributions_to_dependents_if_incapacitated',
      DEFAULT_TRUST_DETAILS.allow_distributions_to_dependents_if_incapacitated,
    ),
    include_no_contest_clause: readBoolean(raw, 'include_no_contest_clause', DEFAULT_TRUST_DETAILS.include_no_contest_clause),
    name_people_in_no_contest_clause: readBoolean(raw, 'name_people_in_no_contest_clause', DEFAULT_TRUST_DETAILS.name_people_in_no_contest_clause),
    require_mandatory_arbitration: readBoolean(raw, 'require_mandatory_arbitration', DEFAULT_TRUST_DETAILS.require_mandatory_arbitration),
    prorate_estate_taxes: readBoolean(raw, 'prorate_estate_taxes', DEFAULT_TRUST_DETAILS.prorate_estate_taxes),
    representation_type: readString(raw, 'representation_type', DEFAULT_TRUST_DETAILS.representation_type),
    survivorship_requirement_days: readNumber(raw, 'survivorship_requirement_days', DEFAULT_TRUST_DETAILS.survivorship_requirement_days),
    include_discretionary_distribution_definition: readBoolean(
      raw,
      'include_discretionary_distribution_definition',
      DEFAULT_TRUST_DETAILS.include_discretionary_distribution_definition,
    ),
    include_education_expenses_definition: readBoolean(
      raw,
      'include_education_expenses_definition',
      DEFAULT_TRUST_DETAILS.include_education_expenses_definition,
    ),
    include_arts_education: readBoolean(raw, 'include_arts_education', DEFAULT_TRUST_DETAILS.include_arts_education),
    include_vocational_training: readBoolean(raw, 'include_vocational_training', DEFAULT_TRUST_DETAILS.include_vocational_training),
    include_homeschooling: readBoolean(raw, 'include_homeschooling', DEFAULT_TRUST_DETAILS.include_homeschooling),
    include_disappearance_definition: readBoolean(raw, 'include_disappearance_definition', DEFAULT_TRUST_DETAILS.include_disappearance_definition),
  }
}

export function setTrustDetails(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<TrustDetailsProvisions>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = trustDetailsRaw(sheet)
  const current = getTrustDetails(sheet)

  return {
    ...decisions,
    trust_details: {
      ...raw,
      ...current,
      ...patch,
    },
  }
}

function trustNameInitials(name: string): string {
  return name
    .split(/\s+/)
    .map(part => part.replace(/[^a-zA-Z]/g, '')[0] ?? '')
    .join('')
    .toUpperCase()
}

export function buildTrustNameSuggestions(
  sheet: Pick<DesignSheet, 'client_name' | 'spouse_name' | 'is_joint'>,
  matter: Pick<{ client_name?: string | null; spouse_name?: string | null }, 'client_name' | 'spouse_name'>,
): string[] {
  const clientName = (sheet.client_name ?? matter.client_name ?? '').trim()
  const spouseName = (sheet.spouse_name ?? matter.spouse_name ?? '').trim()
  const familyLast = clientName.split(/\s+/).at(-1) || 'Family'

  if (sheet.is_joint) {
    return [...new Set([
      `The ${familyLast} Family Trust`,
      `The ${clientName || 'Client'} and ${spouseName || 'Spouse'} Trust`,
    ])]
  }

  const initials = trustNameInitials(clientName)
  return [...new Set([
    `The ${clientName || 'Client'} Trust`,
    `The ${initials || 'Client'} Trust`,
  ])]
}

/** Quick-fill suggestions for the spouse's separate trust: full name and initials. */
export function buildSpouseTrustNameSuggestions(
  sheet: Pick<DesignSheet, 'spouse_name'>,
  matter: Pick<{ spouse_name?: string | null }, 'spouse_name'>,
): string[] {
  const spouseName = (sheet.spouse_name ?? matter.spouse_name ?? '').trim()
  const initials = trustNameInitials(spouseName)
  return [...new Set([
    `The ${spouseName || 'Spouse'} Trust`,
    `The ${initials || 'Spouse'} Trust`,
  ])]
}

export interface StaggeredDistributionPreset {
  label: string
  tiers: Array<Pick<StaggeredTier, 'age' | 'amount'>>
}

export const STAGGERED_DISTRIBUTION_PRESETS: StaggeredDistributionPreset[] = [
  {
    label: 'All at 30',
    tiers: [{ amount: 'All', age: 30 }],
  },
  {
    label: '1/2 at 25 and 30',
    tiers: [
      { amount: '1/2', age: 25 },
      { amount: '1/2', age: 30 },
    ],
  },
  {
    label: '1/3 at 25, 30, 35',
    tiers: [
      { amount: '1/3', age: 25 },
      { amount: '1/3', age: 30 },
      { amount: '1/3', age: 35 },
    ],
  },
]

export function buildStaggeredTiersFromPreset(
  preset: StaggeredDistributionPreset,
  makeId: () => string,
): StaggeredTier[] {
  return preset.tiers.map(tier => ({ id: makeId(), ...tier }))
}
