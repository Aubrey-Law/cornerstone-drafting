/**
 * Import/proposal support for design-sheet fields that live in the `decisions`
 * JSONB rather than in a column.
 *
 * Why this exists separately from DESIGN_SHEET_IMPORT_FIELDS: a decision field is
 * addressed by `<namespace>.<key>`, not by a bare name. Bare names collide —
 * `power_529_plans` is a field of BOTH `trust_details` and `dpoa_provisions`, and a
 * flat map would silently route one to the other. The qualified key is also what
 * fixes the older single-field special case: `residual_beneficiary_method` used to
 * ride along as a top-level import field, and accepting it wrote
 * `decisions.residual_beneficiary_method`, which nothing reads —
 * `getTrustDetails` only ever looks at `decisions.trust_details.*`.
 *
 * Reads go against the RAW stored blob, never the typed getters. The getters
 * substitute defaults for unset keys (`co_trustee_decision` reads back
 * 'joint_majority' on a blank sheet), so a getter can never answer "has the
 * attorney decided this yet?" — and that question is what drives both the blank
 * detection here and the open-field list the completion engine sends to the model.
 *
 * Writes go through the typed setters, which own the merge semantics for their
 * namespace (DPOA fans `all_basic_powers` out across the 13 individual powers;
 * healthcare keeps the legacy shared HIPAA agent list in sync with the client one).
 */
import {
  DPOA_BASIC_POWER_KEYS,
  DPOA_BASIC_POWER_LABELS,
  DPOA_TRUST_POWER_KEYS,
  setDesignSheetDpoaProvisions,
  type DesignSheetDpoaProvisions,
  type DpoaAgentCompensation,
  type DpoaBasicPowerKey,
  type DpoaCoagentServing,
} from '@/lib/designSheetDpoaProvisions'
import {
  setDesignSheetHealthcareProvisions,
  type AdvanceDirectiveChoice,
  type AnatomicalGiftPreference,
  type DesignSheetHealthcareProvisions,
  type HipaaFiduciaryListing,
} from '@/lib/designSheetHealthcareProvisions'
import {
  RESIDUAL_BENEFICIARY_METHODS,
  setTrustDetails,
  type InitialTrusteeNomination,
  type RepresentationType,
  type ResiduaryAfterDeath,
  type SuccessorTrusteeVacancy,
  type TrustCoTrusteeDecision,
  type TrustDetailsProvisions,
  type TrusteeCompensation,
} from '@/lib/designSheetTrustDetails'
import {
  setWillPersonalRepresentativePowers,
  type WillPersonalRepresentativePowers,
} from '@/lib/designSheetWillPowers'
import { mergeDecisionUpdates } from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet } from '@/types/database'

export type DecisionNamespace =
  | 'trust_details'
  | 'dpoa_provisions'
  | 'healthcare_provisions'
  | 'will_pr_powers'

export type DecisionFieldKind = 'string' | 'boolean' | 'number'

export const DECISION_NAMESPACES = [
  'trust_details',
  'dpoa_provisions',
  'healthcare_provisions',
  'will_pr_powers',
] as const satisfies readonly DecisionNamespace[]

export interface DecisionFieldMeta {
  namespace: DecisionNamespace
  /** Key within the namespace. Dotted for the one nested case, `basic_powers.<power>`. */
  key: string
  section: string
  label: string
  kind: DecisionFieldKind
  options?: readonly string[]
}

// Option lists are pinned to their unions with `satisfies`, so a value that drifts
// from the type is a compile error rather than an entry that silently never matches.
const INITIAL_TRUSTEE_NOMINATIONS = [
  'grantor',
  'grantor_and_spouse',
  'single_initial_trustee',
  'client',
  'spouse',
  'client_and_spouse',
] as const satisfies readonly InitialTrusteeNomination[]

const CO_TRUSTEE_DECISIONS = [
  'joint_majority',
  'independent',
  'omit',
  'settlor_separate_others_joint',
] as const satisfies readonly TrustCoTrusteeDecision[]

const TRUSTEE_COMPENSATIONS = [
  'prevailing_corporate',
  'prevailing_professional',
  'reasonable',
  'based_on_trustee_type',
  'none',
] as const satisfies readonly TrusteeCompensation[]

const SUCCESSOR_TRUSTEE_VACANCIES = [
  'income_beneficiaries_any',
  'income_beneficiaries_professional',
  'resigning_neutral',
  'resigning_professional',
  'settlor_or_court',
] as const satisfies readonly SuccessorTrusteeVacancy[]

const RESIDUARY_AFTER_DEATH = [
  'descendants_outright_per_stirpes',
  'descendants_shares_outright_children_trusts_others',
  'descendants_shares_all_trusts',
  'named_beneficiaries_separate_terms',
] as const satisfies readonly ResiduaryAfterDeath[]

const REPRESENTATION_TYPES = [
  'by_representation',
  'per_stirpes',
  'per_capita_each_generation',
] as const satisfies readonly RepresentationType[]

const DPOA_AGENT_COMPENSATIONS = [
  'prevailing_professional',
  'reasonable',
  'none',
] as const satisfies readonly DpoaAgentCompensation[]

const DPOA_COAGENT_SERVING = [
  'jointly',
  'separately',
  'silent',
] as const satisfies readonly DpoaCoagentServing[]

const ANATOMICAL_GIFTS = ['yes', 'defer', 'no'] as const satisfies readonly AnatomicalGiftPreference[]

const ADVANCE_DIRECTIVES = [
  'prolong_life',
  'do_not_resuscitate',
  'do_not_prolong_life',
] as const satisfies readonly AdvanceDirectiveChoice[]

const HIPAA_FIDUCIARY_LISTINGS = [
  'by_name',
  'general_language',
] as const satisfies readonly HipaaFiduciaryListing[]

const TRUST = 'Trust'
const WILL = 'Will'
const DPOA = 'Durable Power of Attorney'
const HEALTHCARE = 'Health Care Documents'

function trustField(
  key: keyof TrustDetailsProvisions,
  label: string,
  kind: DecisionFieldKind,
  options?: readonly string[],
): DecisionFieldMeta {
  return { namespace: 'trust_details', key, section: TRUST, label, kind, options }
}

function dpoaField(
  key: keyof DesignSheetDpoaProvisions,
  label: string,
  kind: DecisionFieldKind,
  options?: readonly string[],
): DecisionFieldMeta {
  return { namespace: 'dpoa_provisions', key, section: DPOA, label, kind, options }
}

function healthcareField(
  key: keyof DesignSheetHealthcareProvisions,
  label: string,
  kind: DecisionFieldKind,
  options?: readonly string[],
): DecisionFieldMeta {
  return { namespace: 'healthcare_provisions', key, section: HEALTHCARE, label, kind, options }
}

function willPowerField(
  key: keyof WillPersonalRepresentativePowers,
  label: string,
): DecisionFieldMeta {
  return { namespace: 'will_pr_powers', key, section: WILL, label, kind: 'boolean' }
}

type BasicPowerFieldKey = `dpoa_provisions.basic_powers.${DpoaBasicPowerKey}`

const BASIC_POWER_FIELDS = Object.fromEntries(
  DPOA_BASIC_POWER_KEYS.map((power: DpoaBasicPowerKey) => [
    `dpoa_provisions.basic_powers.${power}`,
    {
      namespace: 'dpoa_provisions',
      key: `basic_powers.${power}`,
      section: DPOA,
      label: DPOA_BASIC_POWER_LABELS[power],
      kind: 'boolean',
    } satisfies DecisionFieldMeta,
  ]),
) as Record<BasicPowerFieldKey, DecisionFieldMeta>

const TRUST_POWER_LABELS: Record<(typeof DPOA_TRUST_POWER_KEYS)[number], string> = {
  agent_may_create_trusts: 'Agent may create trusts',
  agent_may_create_trusts_for_dependents: 'Agent may create trusts for dependents',
  allow_agent_as_trustee: 'Agent may serve as trustee',
  agent_may_create_medicaid_trusts: 'Agent may create Medicaid trusts',
  agent_may_modify_sole_settlor_trusts: 'Agent may modify sole-settlor trusts',
  agent_may_modify_joint_trusts: 'Agent may modify joint trusts',
}

type TrustPowerFieldKey = `dpoa_provisions.${(typeof DPOA_TRUST_POWER_KEYS)[number]}`

const TRUST_POWER_FIELDS = Object.fromEntries(
  DPOA_TRUST_POWER_KEYS.map(power => [
    `dpoa_provisions.${power}`,
    dpoaField(power, TRUST_POWER_LABELS[power], 'boolean'),
  ]),
) as Record<TrustPowerFieldKey, DecisionFieldMeta>

export const DESIGN_SHEET_DECISION_FIELDS = {
  // --- decisions.trust_details -----------------------------------------------
  'trust_details.initial_trustee_nomination': trustField('initial_trustee_nomination', 'Initial trustee nomination', 'string', INITIAL_TRUSTEE_NOMINATIONS),
  'trust_details.spouse_initial_trustee_nomination': trustField('spouse_initial_trustee_nomination', 'Spouse initial trustee nomination', 'string', INITIAL_TRUSTEE_NOMINATIONS),
  'trust_details.co_trustee_decision': trustField('co_trustee_decision', 'Co-trustee decision standard', 'string', CO_TRUSTEE_DECISIONS),
  'trust_details.trustee_compensation': trustField('trustee_compensation', 'Trustee compensation', 'string', TRUSTEE_COMPENSATIONS),
  'trust_details.successor_trustee_vacancy': trustField('successor_trustee_vacancy', 'Successor trustee vacancy', 'string', SUCCESSOR_TRUSTEE_VACANCIES),
  'trust_details.residual_beneficiary_method': trustField('residual_beneficiary_method', 'Residual beneficiary method', 'string', RESIDUAL_BENEFICIARY_METHODS),
  'trust_details.residuary_after_death': trustField('residuary_after_death', 'Residuary after death', 'string', RESIDUARY_AFTER_DEATH),
  'trust_details.representation_type': trustField('representation_type', 'Representation type', 'string', REPRESENTATION_TYPES),
  'trust_details.special_trustee_instructions': trustField('special_trustee_instructions', 'Special trustee instructions', 'string'),
  'trust_details.special_distributions_age': trustField('special_distributions_age', 'Special distributions age', 'number'),
  'trust_details.survivorship_requirement_days': trustField('survivorship_requirement_days', 'Survivorship requirement (days)', 'number'),
  'trust_details.protect_us_trust_status': trustField('protect_us_trust_status', 'Protect US trust status', 'boolean'),
  'trust_details.allow_special_trustee': trustField('allow_special_trustee', 'Allow special trustee', 'boolean'),
  'trust_details.power_529_plans': trustField('power_529_plans', 'Trustee power over 529 plans', 'boolean'),
  'trust_details.power_farms_ranches': trustField('power_farms_ranches', 'Trustee power over farms and ranches', 'boolean'),
  'trust_details.power_closely_held_businesses': trustField('power_closely_held_businesses', 'Trustee power over closely held businesses', 'boolean'),
  'trust_details.power_professional_corporations': trustField('power_professional_corporations', 'Trustee power over professional corporations', 'boolean'),
  'trust_details.subchapter_s_provisions': trustField('subchapter_s_provisions', 'Subchapter S provisions', 'boolean'),
  'trust_details.allow_trustee_change_situs': trustField('allow_trustee_change_situs', 'Trustee may change situs', 'boolean'),
  'trust_details.include_common_trust_for_children': trustField('include_common_trust_for_children', 'Common trust for children', 'boolean'),
  'trust_details.hold_distributions_for_young_beneficiaries': trustField('hold_distributions_for_young_beneficiaries', 'Hold distributions for young beneficiaries', 'boolean'),
  'trust_details.include_substance_abuse': trustField('include_substance_abuse', 'Substance abuse provisions', 'boolean'),
  'trust_details.include_creditor_divorce_provisions': trustField('include_creditor_divorce_provisions', 'Creditor and divorce provisions', 'boolean'),
  'trust_details.include_contingent_snt': trustField('include_contingent_snt', 'Contingent special needs trust', 'boolean'),
  'trust_details.allow_distributions_to_dependents_if_incapacitated': trustField('allow_distributions_to_dependents_if_incapacitated', 'Distributions to dependents if incapacitated', 'boolean'),
  'trust_details.include_no_contest_clause': trustField('include_no_contest_clause', 'Trust no-contest clause', 'boolean'),
  'trust_details.name_people_in_no_contest_clause': trustField('name_people_in_no_contest_clause', 'Name people in no-contest clause', 'boolean'),
  'trust_details.require_mandatory_arbitration': trustField('require_mandatory_arbitration', 'Mandatory arbitration', 'boolean'),
  'trust_details.prorate_estate_taxes': trustField('prorate_estate_taxes', 'Prorate estate taxes', 'boolean'),
  'trust_details.include_discretionary_distribution_definition': trustField('include_discretionary_distribution_definition', 'Discretionary distribution definition', 'boolean'),
  'trust_details.include_education_expenses_definition': trustField('include_education_expenses_definition', 'Education expenses definition', 'boolean'),
  'trust_details.include_arts_education': trustField('include_arts_education', 'Arts education', 'boolean'),
  'trust_details.include_vocational_training': trustField('include_vocational_training', 'Vocational training', 'boolean'),
  'trust_details.include_homeschooling': trustField('include_homeschooling', 'Homeschooling', 'boolean'),
  'trust_details.include_disappearance_definition': trustField('include_disappearance_definition', 'Disappearance definition', 'boolean'),

  // --- decisions.dpoa_provisions ---------------------------------------------
  'dpoa_provisions.agent_compensation': dpoaField('agent_compensation', 'Agent compensation', 'string', DPOA_AGENT_COMPENSATIONS),
  'dpoa_provisions.coagent_serving': dpoaField('coagent_serving', 'Co-agent serving manner', 'string', DPOA_COAGENT_SERVING),
  'dpoa_provisions.include_entity_powers': dpoaField('include_entity_powers', 'Entity powers', 'boolean'),
  'dpoa_provisions.include_advanced_trust_gifting': dpoaField('include_advanced_trust_gifting', 'Advanced trust and gifting powers', 'boolean'),
  'dpoa_provisions.include_extended_personal_care': dpoaField('include_extended_personal_care', 'Extended personal care', 'boolean'),
  'dpoa_provisions.allow_gifts': dpoaField('allow_gifts', 'Allow gifts', 'boolean'),
  'dpoa_provisions.include_trust_powers': dpoaField('include_trust_powers', 'Trust powers', 'boolean'),
  'dpoa_provisions.allow_delegation': dpoaField('allow_delegation', 'Allow delegation', 'boolean'),
  'dpoa_provisions.prohibit_arbitration': dpoaField('prohibit_arbitration', 'Prohibit arbitration', 'boolean'),
  'dpoa_provisions.power_529_plans': dpoaField('power_529_plans', 'Agent power over 529 plans', 'boolean'),
  'dpoa_provisions.allow_medical_information_access': dpoaField('allow_medical_information_access', 'Allow medical information access', 'boolean'),
  'dpoa_provisions.power_digital_assets': dpoaField('power_digital_assets', 'Digital asset powers', 'boolean'),
  'dpoa_provisions.allow_self_designation_beneficiary': dpoaField('allow_self_designation_beneficiary', 'Allow self-designation as beneficiary', 'boolean'),
  'dpoa_provisions.all_basic_powers': dpoaField('all_basic_powers', 'All basic powers', 'boolean'),
  'dpoa_provisions.additional_powers': dpoaField('additional_powers', 'Additional powers', 'string'),
  'dpoa_provisions.specific_businesses': dpoaField('specific_businesses', 'Specific businesses', 'string'),
  'dpoa_provisions.additional_limitations': dpoaField('additional_limitations', 'Additional limitations', 'string'),
  ...TRUST_POWER_FIELDS,
  ...BASIC_POWER_FIELDS,

  // --- decisions.healthcare_provisions ---------------------------------------
  'healthcare_provisions.client_anatomical_gift': healthcareField('client_anatomical_gift', 'Client anatomical gift', 'string', ANATOMICAL_GIFTS),
  'healthcare_provisions.spouse_anatomical_gift': healthcareField('spouse_anatomical_gift', 'Spouse anatomical gift', 'string', ANATOMICAL_GIFTS),
  'healthcare_provisions.spouse_anatomical_restrictions': healthcareField('spouse_anatomical_restrictions', 'Spouse anatomical gift restrictions', 'string'),
  'healthcare_provisions.client_advance_directive': healthcareField('client_advance_directive', 'Client advance directive', 'string', ADVANCE_DIRECTIVES),
  'healthcare_provisions.spouse_advance_directive': healthcareField('spouse_advance_directive', 'Spouse advance directive', 'string', ADVANCE_DIRECTIVES),
  'healthcare_provisions.hipaa_include_poa': healthcareField('hipaa_include_poa', 'HIPAA includes attorney-in-fact', 'boolean'),
  'healthcare_provisions.hipaa_include_trustees': healthcareField('hipaa_include_trustees', 'HIPAA includes trustees', 'boolean'),
  'healthcare_provisions.hipaa_list_fiduciaries_by_name': healthcareField('hipaa_list_fiduciaries_by_name', 'HIPAA fiduciary listing', 'string', HIPAA_FIDUCIARY_LISTINGS),

  // --- decisions.will_pr_powers ----------------------------------------------
  'will_pr_powers.allow_pay_taxes_debts_expenses': willPowerField('allow_pay_taxes_debts_expenses', 'PR may pay taxes, debts and expenses'),
  'will_pr_powers.allow_manage_digital_assets': willPowerField('allow_manage_digital_assets', 'PR may manage digital assets'),
  'will_pr_powers.include_distribution_cash_or_kind': willPowerField('include_distribution_cash_or_kind', 'PR may distribute in cash or in kind'),
} satisfies Record<string, DecisionFieldMeta>

export type DesignSheetDecisionField = keyof typeof DESIGN_SHEET_DECISION_FIELDS

export function isDesignSheetDecisionField(field: string): field is DesignSheetDecisionField {
  return field in DESIGN_SHEET_DECISION_FIELDS
}

function decisionFieldMeta(field: string): DecisionFieldMeta | undefined {
  return (DESIGN_SHEET_DECISION_FIELDS as Record<string, DecisionFieldMeta>)[field]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The stored value for a decision field, or `undefined` when the attorney has not
 * set it. Deliberately reads the raw blob — see the module comment on why the
 * typed getters cannot answer this.
 */
export function readDecisionFieldRaw(
  sheet: Pick<DesignSheet, 'decisions'> | null,
  field: string,
): unknown {
  const meta = decisionFieldMeta(field)
  if (!meta) return undefined

  const decisions = sheet && isRecord(sheet.decisions) ? sheet.decisions : {}
  let cursor: unknown = decisions[meta.namespace]
  for (const segment of meta.key.split('.')) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/**
 * Rewrite a nested namespace object into the qualified keys the registry uses.
 *
 * The extraction prompt asks for `{"trust_details.co_trustee_decision": ...}`, but
 * models reliably produce the nested shape some of the time. Silently dropping
 * those would look like "the document didn't mention it", so accept both and
 * normalise here. Only paths the registry knows survive; anything else is left
 * alone for the caller's own allowlist check to reject.
 */
export function flattenDecisionNamespaces(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed }

  for (const namespace of DECISION_NAMESPACES) {
    const nested = out[namespace]
    if (!isRecord(nested)) continue

    const walk = (node: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(node)) {
        const qualified = `${path}.${key}`
        if (qualified in DESIGN_SHEET_DECISION_FIELDS) {
          out[qualified] = value
        } else if (isRecord(value)) {
          walk(value, qualified)
        }
      }
    }
    walk(nested, namespace)
    delete out[namespace]
  }

  return out
}

/**
 * Fold accepted decision-field values into a new `decisions` blob.
 *
 * Grouped by namespace and applied through `mergeDecisionUpdates` so each setter
 * sees the result of the previous one — applying them independently against the
 * original sheet would have the last writer drop the others' namespaces.
 */
export function applyDecisionFieldValues(
  sheet: Pick<DesignSheet, 'decisions' | 'hcp_anatomical_gift' | 'dpoa_coagent_manner'>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const trustPatch: Record<string, unknown> = {}
  const dpoaPatch: Record<string, unknown> = {}
  const basicPowersPatch: Partial<Record<DpoaBasicPowerKey, boolean>> = {}
  const healthcarePatch: Record<string, unknown> = {}
  const willPowersPatch: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(values)) {
    const meta = decisionFieldMeta(field)
    if (!meta) continue

    if (meta.namespace === 'trust_details') {
      trustPatch[meta.key] = value
      continue
    }
    if (meta.namespace === 'healthcare_provisions') {
      healthcarePatch[meta.key] = value
      continue
    }
    if (meta.namespace === 'will_pr_powers') {
      willPowersPatch[meta.key] = value
      continue
    }
    // dpoa_provisions — the only namespace with a nested key.
    const [head, nested] = meta.key.split('.')
    if (head === 'basic_powers' && nested) {
      basicPowersPatch[nested as DpoaBasicPowerKey] = value === true
      continue
    }
    dpoaPatch[meta.key] = value
  }

  const updates: Array<(current: Pick<DesignSheet, 'decisions'>) => Record<string, unknown>> = []

  if (Object.keys(trustPatch).length > 0) {
    updates.push(current => setTrustDetails(current, trustPatch as Partial<TrustDetailsProvisions>))
  }
  if (Object.keys(dpoaPatch).length > 0 || Object.keys(basicPowersPatch).length > 0) {
    updates.push(current => {
      // Merge onto the powers already stored rather than the bare patch: the setter
      // replaces `basic_powers` wholesale and recomputes `all_basic_powers` from it,
      // so a partial record would switch off every power the attorney had set.
      const storedPowers = DPOA_BASIC_POWER_KEYS.reduce((acc, power) => {
        acc[power] = readDecisionFieldRaw(current, `dpoa_provisions.basic_powers.${power}`) === true
        return acc
      }, {} as Record<DpoaBasicPowerKey, boolean>)

      const patch = { ...dpoaPatch } as Partial<DesignSheetDpoaProvisions>
      if (Object.keys(basicPowersPatch).length > 0) {
        patch.basic_powers = { ...storedPowers, ...basicPowersPatch }
      }
      return setDesignSheetDpoaProvisions(
        { ...current, dpoa_coagent_manner: sheet.dpoa_coagent_manner ?? null },
        patch,
      )
    })
  }
  if (Object.keys(healthcarePatch).length > 0) {
    updates.push(current => setDesignSheetHealthcareProvisions(
      { ...current, hcp_anatomical_gift: sheet.hcp_anatomical_gift ?? null },
      healthcarePatch as Partial<DesignSheetHealthcareProvisions>,
    ))
  }
  if (Object.keys(willPowersPatch).length > 0) {
    updates.push(current => setWillPersonalRepresentativePowers(
      current,
      willPowersPatch as Partial<WillPersonalRepresentativePowers>,
    ))
  }

  if (updates.length === 0) return isRecord(sheet.decisions) ? { ...sheet.decisions } : {}
  return mergeDecisionUpdates(sheet, ...updates)
}
