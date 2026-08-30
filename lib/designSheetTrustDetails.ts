import { readAllowedValue } from '@/lib/designSheet/decisionReaders'
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
 * Hyphens are folded to underscores for back-compat: the design sheet's option value
 * used to be `trust-for-life` while the union is `trust_for_life`, and an
 * `as ResidualBeneficiaryMethod` cast kept the compiler from noticing. The option
 * value is corrected now, so this only serves sheets written before that.
 */
export function normalizeResidualBeneficiaryMethod(value: unknown): ResidualBeneficiaryMethod | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/-/g, '_')
  return (RESIDUAL_BENEFICIARY_METHODS as readonly string[]).includes(normalized)
    ? normalized as ResidualBeneficiaryMethod
    : null
}

/**
 * The method the UI, readiness and the generator all resolve to.
 *
 * `decisions.trust_details.residual_beneficiary_method` is the single home. This
 * used to fall back to a `distribution_method` column that the design sheet wrote
 * in parallel; that column has been backfilled into trust_details and dropped.
 */
export function resolveResidualBeneficiaryMethod(
  sheet: Pick<DesignSheet, 'decisions'>,
): ResidualBeneficiaryMethod | null {
  return normalizeResidualBeneficiaryMethod(getTrustDetails(sheet).residual_beneficiary_method)
}

export type ResiduaryAfterDeath =
  | 'descendants_outright_per_stirpes'
  | 'descendants_shares_outright_children_trusts_others'
  | 'descendants_shares_all_trusts'
  | 'named_beneficiaries_separate_terms'

export type RepresentationType = 'by_representation' | 'per_stirpes' | 'per_capita_each_generation'

/** Who decides a settlor has become incapacitated. */
export type SettlorIncapacityDeterminer =
  | 'attending_and_second_physician'
  | 'single_physician'
  | 'attending_or_any_two_physicians'
  | 'physician_or_psychologist'
  | 'two_physicians'
  | 'two_physicians_or_psychologists'
  | 'physician_and_psychologist'
  | 'attorney_at_law'
  | 'governmental_official'
  | 'trust_protector'
  | 'successor_trustee'
  | 'majority_of_adult_children'
  | 'incapacity_panel'
  | 'court'
  | 'other_settlor_and_successor_trustee'
  | 'custom'

export const SETTLOR_INCAPACITY_DETERMINERS: readonly SettlorIncapacityDeterminer[] = [
  'attending_and_second_physician', 'single_physician', 'attending_or_any_two_physicians',
  'physician_or_psychologist', 'two_physicians', 'two_physicians_or_psychologists',
  'physician_and_psychologist', 'attorney_at_law', 'governmental_official', 'trust_protector',
  'successor_trustee', 'majority_of_adult_children', 'incapacity_panel', 'court',
  'other_settlor_and_successor_trustee', 'custom',
] as const

/** Who decides a currently-acting trustee has become incapacitated. A trustee
 *  cannot be judged by their own successor or by the other settlor, so that
 *  subset of the settlor list does not apply here. */
export type TrusteeIncapacityDeterminer =
  | 'attending_and_second_physician'
  | 'single_physician'
  | 'attending_or_any_two_physicians'
  | 'physician_or_psychologist'
  | 'two_physicians'
  | 'two_physicians_or_psychologists'
  | 'physician_and_psychologist'
  | 'attorney_at_law'
  | 'governmental_official'
  | 'trust_protector'
  | 'court'
  | 'custom'

export const TRUSTEE_INCAPACITY_DETERMINERS: readonly TrusteeIncapacityDeterminer[] = [
  'attending_and_second_physician', 'single_physician', 'attending_or_any_two_physicians',
  'physician_or_psychologist', 'two_physicians', 'two_physicians_or_psychologists',
  'physician_and_psychologist', 'attorney_at_law', 'governmental_official', 'trust_protector',
  'court', 'custom',
] as const

/**
 * How the documents define a parent-child relationship — the state's probate
 * code, or a definition drafted for this family (adopted adults, stepchildren,
 * children of assisted reproduction).
 */
export type ParentChildRelationshipDefinition = 'state_probate_code' | 'custom'

export const PARENT_CHILD_RELATIONSHIP_DEFINITIONS: readonly ParentChildRelationshipDefinition[] =
  ['state_probate_code', 'custom'] as const

/** How each settlor's Schedule A lists the trust's assets. */
/**
 * Marital and bypass trust structure at the first spouse's death.
 *
 * One set of fields serves both plan shapes, because they answer the same
 * questions: a joint trust divides the deceased settlor's share before the
 * remainder joins the Survivor's Trust, and a separate trust that distributes
 * in trust for the spouse divides the residuary the same way. `is_joint`
 * decides which wording and which option subset the design sheet shows —
 * see MaritalBypassTrustOptions.tsx — so the two can never both be answered.
 *
 * The marital and bypass choices are independent: a plan may create either,
 * both, or neither. That is why they are two fields rather than one combined
 * structure enum.
 */
export type MaritalTrustType =
  | 'none'
  | 'general_power_of_appointment'
  | 'qtip'

export const MARITAL_TRUST_TYPES: readonly MaritalTrustType[] = [
  'none',
  'general_power_of_appointment',
  'qtip',
] as const

/** How far the surviving spouse may reach the Marital Trust principal. */
export type MaritalTrustInvasion =
  | 'no_invasion'
  | 'hems'
  | 'five_by_five'
  | 'complete'

export const MARITAL_TRUST_INVASIONS: readonly MaritalTrustInvasion[] = [
  'no_invasion',
  'hems',
  'five_by_five',
  'complete',
] as const

/**
 * Whether the surviving spouse may redirect what is left in a trust at their
 * death. Shared by the marital (QTIP) and bypass trusts — the two questions have
 * the same two answers — but stored separately so one may be granted alone.
 */
export type TrustRemainderPowerOfAppointment = 'none' | 'limited_testamentary'

export const TRUST_REMAINDER_POWERS_OF_APPOINTMENT:
  readonly TrustRemainderPowerOfAppointment[] = ['none', 'limited_testamentary'] as const

/**
 * `bypass` is the mandatory credit-shelter trust — the joint sheet calls it
 * "Bypass Trust (A/B)", the separate sheet "Bypass/Credit-Shelter Trust".
 * `disclaimer` funds only from what the survivor disclaims.
 */
export type BypassTrustType = 'none' | 'bypass' | 'disclaimer'

export const BYPASS_TRUST_TYPES: readonly BypassTrustType[] = [
  'none',
  'bypass',
  'disclaimer',
] as const

/** How much of the deceased spouse's share funds the bypass trust. */
export type BypassTrustFormula =
  | 'all_assets'
  | 'formula'
  | 'fixed_amount'
  | 'percentage'
  | 'clayton_election'

export const BYPASS_TRUST_FORMULAS: readonly BypassTrustFormula[] = [
  'all_assets',
  'formula',
  'fixed_amount',
  'percentage',
  'clayton_election',
] as const

/**
 * True when the selected marital trust actually creates one — the invasion,
 * QDOT and (for a QTIP) remainder-appointment questions only mean something
 * then, and the marital deduction savings language becomes mandatory.
 */
export function createsMaritalTrust(value: MaritalTrustType | null): boolean {
  return value === 'general_power_of_appointment' || value === 'qtip'
}

/** True when the selected bypass option creates a trust of any kind. */
export function createsBypassTrust(value: BypassTrustType | null): boolean {
  return value === 'bypass' || value === 'disclaimer'
}

export type AssetScheduleFormat = 'table' | 'paragraph'

export const ASSET_SCHEDULE_FORMATS: readonly AssetScheduleFormat[] = ['table', 'paragraph'] as const

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

  /** Marital and bypass structure at the first spouse's death. */
  marital_trust: MaritalTrustType | null
  marital_trust_invasion: MaritalTrustInvasion | null
  marital_trust_remainder_power: TrustRemainderPowerOfAppointment | null
  marital_trust_include_qdot: boolean
  bypass_trust: BypassTrustType | null
  bypass_trust_formula: BypassTrustFormula | null
  bypass_trust_fixed_amount: number | null
  bypass_trust_percentage: number | null
  bypass_trust_remainder_power: TrustRemainderPowerOfAppointment | null
  bypass_trust_allow_sprinkling: boolean
  residual_beneficiary_method: ResidualBeneficiaryMethod | null
  residuary_after_death: ResiduaryAfterDeath | null
  include_common_trust_for_children: boolean
  special_distributions_age: number | null
  hold_distributions_for_young_beneficiaries: boolean
  include_substance_abuse: boolean
  include_creditor_divorce_provisions: boolean
  include_marital_deduction_savings_language: boolean
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
  /**
   * How the documents define who counts as a parent and child. The interview
   * form asks it under family information; it is stored with the other
   * definition toggles because that is the article it is drafted into.
   */
  parent_child_relationship_definition: ParentChildRelationshipDefinition | null
  // Trustee administration
  require_trustee_bond: boolean
  limit_duty_to_account: boolean
  include_reverse_mortgage_clause: boolean
  include_firearms_provisions: boolean
  allow_sole_trustee_to_appoint_cotrustees: boolean
  allow_trustee_to_designate_alternates: boolean
  // Distributions and protections
  include_retirement_account_provisions: boolean
  allow_protector_convert_conduit_trusts: boolean
  allow_direct_distributions_to_young_or_incapacitated: boolean
  include_slayer_provision: boolean
  allow_charitable_giving_during_incapacity: boolean
  forgive_all_debts: boolean
  // Incapacity
  include_incapacity_definition: boolean
  allow_psychologist_substitute: boolean
  allow_pa_np_substitute: boolean
  settlor_incapacity_determined_by: SettlorIncapacityDeterminer | null
  trustee_incapacity_determined_by: TrusteeIncapacityDeterminer | null
  // Asset schedules
  asset_schedule_signature_block: boolean
  asset_schedule_catchall: boolean
  asset_schedule_non_trust: boolean
  asset_schedule_format: AssetScheduleFormat | null
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
  // Null, not 'none': "no marital trust" is a decision the attorney makes, and
  // defaulting it to an answer would let a joint trust draft a structure nobody
  // chose. The UI shows nothing selected until one is.
  marital_trust: null,
  marital_trust_invasion: null,
  marital_trust_remainder_power: null,
  marital_trust_include_qdot: false,
  bypass_trust: null,
  bypass_trust_formula: null,
  bypass_trust_fixed_amount: null,
  bypass_trust_percentage: null,
  bypass_trust_remainder_power: null,
  bypass_trust_allow_sprinkling: false,
  residual_beneficiary_method: null,
  residuary_after_death: null,
  include_common_trust_for_children: false,
  special_distributions_age: null,
  hold_distributions_for_young_beneficiaries: false,
  include_substance_abuse: false,
  include_creditor_divorce_provisions: false,
  include_marital_deduction_savings_language: false,
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
  parent_child_relationship_definition: null,
  require_trustee_bond: false,
  limit_duty_to_account: false,
  include_reverse_mortgage_clause: false,
  include_firearms_provisions: false,
  allow_sole_trustee_to_appoint_cotrustees: false,
  allow_trustee_to_designate_alternates: false,
  include_retirement_account_provisions: false,
  allow_protector_convert_conduit_trusts: false,
  allow_direct_distributions_to_young_or_incapacitated: false,
  include_slayer_provision: false,
  allow_charitable_giving_during_incapacity: false,
  forgive_all_debts: false,
  include_incapacity_definition: false,
  allow_psychologist_substitute: false,
  allow_pa_np_substitute: false,
  settlor_incapacity_determined_by: null,
  trustee_incapacity_determined_by: null,
  asset_schedule_signature_block: false,
  asset_schedule_catchall: false,
  asset_schedule_non_trust: false,
  asset_schedule_format: null,
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
    marital_trust: readAllowedValue(raw, 'marital_trust', MARITAL_TRUST_TYPES),
    marital_trust_invasion: readAllowedValue(raw, 'marital_trust_invasion', MARITAL_TRUST_INVASIONS),
    marital_trust_remainder_power: readAllowedValue(
      raw, 'marital_trust_remainder_power', TRUST_REMAINDER_POWERS_OF_APPOINTMENT,
    ),
    marital_trust_include_qdot: readBoolean(raw, 'marital_trust_include_qdot', DEFAULT_TRUST_DETAILS.marital_trust_include_qdot),
    bypass_trust: readAllowedValue(raw, 'bypass_trust', BYPASS_TRUST_TYPES),
    bypass_trust_formula: readAllowedValue(raw, 'bypass_trust_formula', BYPASS_TRUST_FORMULAS),
    bypass_trust_fixed_amount: readNumber(raw, 'bypass_trust_fixed_amount', DEFAULT_TRUST_DETAILS.bypass_trust_fixed_amount),
    bypass_trust_percentage: readNumber(raw, 'bypass_trust_percentage', DEFAULT_TRUST_DETAILS.bypass_trust_percentage),
    bypass_trust_remainder_power: readAllowedValue(
      raw, 'bypass_trust_remainder_power', TRUST_REMAINDER_POWERS_OF_APPOINTMENT,
    ),
    bypass_trust_allow_sprinkling: readBoolean(raw, 'bypass_trust_allow_sprinkling', DEFAULT_TRUST_DETAILS.bypass_trust_allow_sprinkling),
    // Normalised on read so sheets written before the option value was corrected
    // (they stored `trust-for-life`) come back as the canonical union member.
    residual_beneficiary_method: normalizeResidualBeneficiaryMethod(raw.residual_beneficiary_method)
      ?? DEFAULT_TRUST_DETAILS.residual_beneficiary_method,
    residuary_after_death: readString(raw, 'residuary_after_death', DEFAULT_TRUST_DETAILS.residuary_after_death),
    include_common_trust_for_children: readBoolean(raw, 'include_common_trust_for_children', DEFAULT_TRUST_DETAILS.include_common_trust_for_children),
    special_distributions_age: readNumber(raw, 'special_distributions_age', DEFAULT_TRUST_DETAILS.special_distributions_age),
    hold_distributions_for_young_beneficiaries: readBoolean(raw, 'hold_distributions_for_young_beneficiaries', DEFAULT_TRUST_DETAILS.hold_distributions_for_young_beneficiaries),
    include_substance_abuse: readBoolean(raw, 'include_substance_abuse', DEFAULT_TRUST_DETAILS.include_substance_abuse),
    include_creditor_divorce_provisions: readBoolean(raw, 'include_creditor_divorce_provisions', DEFAULT_TRUST_DETAILS.include_creditor_divorce_provisions),
    include_marital_deduction_savings_language: readBoolean(raw, 'include_marital_deduction_savings_language', DEFAULT_TRUST_DETAILS.include_marital_deduction_savings_language),
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
    parent_child_relationship_definition: readAllowedValue(
      raw, 'parent_child_relationship_definition', PARENT_CHILD_RELATIONSHIP_DEFINITIONS,
    ),
    require_trustee_bond: readBoolean(raw, 'require_trustee_bond', DEFAULT_TRUST_DETAILS.require_trustee_bond),
    limit_duty_to_account: readBoolean(raw, 'limit_duty_to_account', DEFAULT_TRUST_DETAILS.limit_duty_to_account),
    include_reverse_mortgage_clause: readBoolean(raw, 'include_reverse_mortgage_clause', DEFAULT_TRUST_DETAILS.include_reverse_mortgage_clause),
    include_firearms_provisions: readBoolean(raw, 'include_firearms_provisions', DEFAULT_TRUST_DETAILS.include_firearms_provisions),
    allow_sole_trustee_to_appoint_cotrustees: readBoolean(raw, 'allow_sole_trustee_to_appoint_cotrustees', DEFAULT_TRUST_DETAILS.allow_sole_trustee_to_appoint_cotrustees),
    allow_trustee_to_designate_alternates: readBoolean(raw, 'allow_trustee_to_designate_alternates', DEFAULT_TRUST_DETAILS.allow_trustee_to_designate_alternates),
    include_retirement_account_provisions: readBoolean(raw, 'include_retirement_account_provisions', DEFAULT_TRUST_DETAILS.include_retirement_account_provisions),
    allow_protector_convert_conduit_trusts: readBoolean(raw, 'allow_protector_convert_conduit_trusts', DEFAULT_TRUST_DETAILS.allow_protector_convert_conduit_trusts),
    allow_direct_distributions_to_young_or_incapacitated: readBoolean(raw, 'allow_direct_distributions_to_young_or_incapacitated', DEFAULT_TRUST_DETAILS.allow_direct_distributions_to_young_or_incapacitated),
    include_slayer_provision: readBoolean(raw, 'include_slayer_provision', DEFAULT_TRUST_DETAILS.include_slayer_provision),
    allow_charitable_giving_during_incapacity: readBoolean(raw, 'allow_charitable_giving_during_incapacity', DEFAULT_TRUST_DETAILS.allow_charitable_giving_during_incapacity),
    forgive_all_debts: readBoolean(raw, 'forgive_all_debts', DEFAULT_TRUST_DETAILS.forgive_all_debts),
    include_incapacity_definition: readBoolean(raw, 'include_incapacity_definition', DEFAULT_TRUST_DETAILS.include_incapacity_definition),
    allow_psychologist_substitute: readBoolean(raw, 'allow_psychologist_substitute', DEFAULT_TRUST_DETAILS.allow_psychologist_substitute),
    allow_pa_np_substitute: readBoolean(raw, 'allow_pa_np_substitute', DEFAULT_TRUST_DETAILS.allow_pa_np_substitute),
    asset_schedule_signature_block: readBoolean(raw, 'asset_schedule_signature_block', DEFAULT_TRUST_DETAILS.asset_schedule_signature_block),
    asset_schedule_catchall: readBoolean(raw, 'asset_schedule_catchall', DEFAULT_TRUST_DETAILS.asset_schedule_catchall),
    asset_schedule_non_trust: readBoolean(raw, 'asset_schedule_non_trust', DEFAULT_TRUST_DETAILS.asset_schedule_non_trust),
    settlor_incapacity_determined_by: readAllowedValue(raw, 'settlor_incapacity_determined_by', SETTLOR_INCAPACITY_DETERMINERS),
    trustee_incapacity_determined_by: readAllowedValue(raw, 'trustee_incapacity_determined_by', TRUSTEE_INCAPACITY_DETERMINERS),
    asset_schedule_format: readAllowedValue(raw, 'asset_schedule_format', ASSET_SCHEDULE_FORMATS),
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
