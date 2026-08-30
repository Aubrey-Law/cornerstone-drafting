/**
 * Statular's interview questions, in its own words, against the design-sheet
 * field that answers each one.
 *
 * Source: `docs/integrations/statular-interview-map.md`, captured from the live
 * interview. This module is the machine-readable half — the export
 * (`statularExport.ts`) renders from it so every line it writes reads the way
 * Statular's own screen reads, which is what its extractor is best at.
 *
 * The two products are close to isomorphic here, which is why this is a table
 * and not a translation layer: our `trust_details` namespace and Statular's
 * Living Trust Details page ask the same questions with the same option sets,
 * down to the sixteen settlor-incapacity determiners. Where a value's stored
 * spelling already matches Statular's, `options` is omitted and the generic
 * humaniser handles it.
 *
 * **This map is expected to grow.** It does not have to be complete to be
 * useful, and it is not: the firm is still extracting pages. A design-sheet
 * field with no entry here still exports — under "Additional answers", with its
 * import-registry label — so adding an entry upgrades a line from our wording to
 * Statular's rather than rescuing it from omission. Adding one is a single
 * object; `tests/statular-export.test.ts` fails if it names a field that does
 * not exist.
 */
import type { DesignSheet } from '@/types/database'
import { getTrustPlanningType } from '@/lib/designSheetDocumentInclusions'

export interface StatularQuestion {
  /** Statular's question text, verbatim. */
  question: string
  /** Design-sheet field: a column name, or `<namespace>.<key>` for a decision. */
  field: string
  /** Statular's wording per stored value. Omit where the stored value reads correctly on its own. */
  options?: Record<string, string>
}

export interface StatularPageGroup {
  /** Statular's page, as its sidebar names it. */
  page: string
  /** The block within the page, where the page has headed blocks. */
  group?: string
  /** Withhold the whole group unless the plan actually reaches these questions. */
  appliesTo?: (sheet: DesignSheet) => boolean
  questions: StatularQuestion[]
}

const YES_NO_ONLY: Record<string, string> = { true: 'Yes', false: 'No' }
void YES_NO_ONLY

/** Shared by both incapacity questions; Statular lists the trustee subset of these. */
const INCAPACITY_DETERMINERS: Record<string, string> = {
  attending_and_second_physician: 'Attending and second physician',
  single_physician: 'Single licensed physician (two if disputed)',
  attending_or_any_two_physicians: 'Attending or any two physicians',
  physician_or_psychologist: 'Single physician or clinical psychologist (two if disputed)',
  two_physicians: 'Two licensed physicians',
  two_physicians_or_psychologists: 'Two physicians or psychologists',
  physician_and_psychologist: 'One physician and one psychologist',
  attorney_at_law: 'Attorney-at-law',
  governmental_official: 'Governmental official',
  trust_protector: 'Trust protector',
  successor_trustee: 'Successor trustee (sworn affidavit, if no dispute)',
  majority_of_adult_children: 'Majority of adult children',
  incapacity_panel: 'Incapacity panel (physician + attorney + third chosen by the first two)',
  court: 'Court of competent jurisdiction',
  other_settlor_and_successor_trustee: 'Other settlor and successor trustee (agreement)',
  custom: 'Custom',
}

const REMAINDER_POWER: Record<string, string> = {
  none: 'No appointment power',
  limited_testamentary: 'Limited testamentary power',
}

const ACKNOWLEDGMENT: Record<string, string> = {
  notary: 'Notary',
  witnesses: 'Two witnesses',
  both: 'Both',
}

/**
 * True when the plan actually divides the residuary at the first spouse's death,
 * which is the only case where the marital and bypass answers describe this
 * plan. A leftover from an earlier structure must not tell Statular to build a
 * trust the plan no longer has.
 */
export function dividesAtFirstDeath(sheet: DesignSheet): boolean {
  if (sheet.is_joint === true) return true
  const planningType = getTrustPlanningType(sheet)
  return planningType !== 'outright_to_spouse' && planningType !== 'not_to_spouse'
}

export const STATULAR_INTERVIEW: StatularPageGroup[] = [
  {
    page: 'Page 2 — Family Information',
    group: 'Settlors',
    questions: [
      { question: 'First Settlor Legal Name', field: 'client_name' },
      { question: 'Aliases', field: 'client_aka' },
      { question: 'Citizenship', field: 'client_citizenship' },
      {
        question: 'Marital Status',
        field: 'marital_status',
        options: {
          married: 'Married',
          civil_union: 'Civil union',
          domestic_partner: 'Registered domestic partnership',
          unmarried_partnership: 'Unmarried partnership',
          single: 'Unmarried',
          divorced: 'Divorced',
          widowed: 'Widowed',
          separated: 'Separated',
        },
      },
      { question: 'Gender', field: 'settlor_facts.client_gender' },
      { question: 'Address — Line 1', field: 'street' },
      { question: 'Address — Line 2', field: 'settlor_facts.street_address_2' },
      { question: 'Address — City', field: 'city' },
      { question: 'Address — State', field: 'state' },
      { question: 'Address — ZIP', field: 'zip' },
      { question: 'Address — County', field: 'county' },
      { question: 'Phone Number', field: 'client_phone' },
      { question: 'Email Address', field: 'client_email' },
      { question: 'Second Settlor Legal Name', field: 'spouse_name' },
      { question: 'Second Settlor Aliases', field: 'spouse_aka' },
      { question: 'Second Settlor Citizenship', field: 'spouse_citizenship' },
      { question: 'Second Settlor Gender', field: 'settlor_facts.spouse_gender' },
      { question: 'Do the settlors live together?', field: 'settlor_facts.settlors_live_together' },
      { question: 'Settlor 2 Phone Number', field: 'spouse_phone' },
      { question: 'Settlor 2 Email Address', field: 'spouse_email' },
    ],
  },
  {
    page: 'Page 2 — Family Information',
    group: 'Information About Settlors',
    questions: [
      { question: 'Date of Marriage or Registration', field: 'marriage_date' },
      { question: 'Place of Marriage or Registration', field: 'settlor_facts.place_of_marriage' },
      {
        question: 'Survivor Designation',
        field: 'settlor_facts.survivor_designation',
        options: { settlor_1: 'Settlor 1', settlor_2: 'Settlor 2', both: 'Both' },
      },
      { question: 'Disabled Veteran?', field: 'settlor_facts.disabled_veteran' },
    ],
  },
  {
    page: 'Page 2 — Family Information',
    group: 'Children',
    questions: [
      { question: 'Children list', field: 'children' },
      { question: 'Include child gender markers', field: 'include_child_gender_markers' },
      { question: 'Include afterborn children', field: 'include_afterborn_children' },
      { question: 'Include posthumous children', field: 'include_expectant_children' },
      { question: 'Omissions intentional', field: 'omissions_intentional' },
      {
        question: 'How should parent-child relationships be defined?',
        field: 'trust_details.parent_child_relationship_definition',
        options: { state_probate_code: 'State Probate Code', custom: 'Custom Definition' },
      },
    ],
  },
  {
    page: 'Page 2 — Family Information',
    group: 'Disinherited Heirs',
    questions: [
      { question: 'Disinherited Children', field: 'disinherited_children' },
      { question: 'Disinherited Heirs', field: 'disinheritances' },
      { question: 'Disinherit issue of every disinherited person', field: 'disinherit_issue' },
      { question: 'Additional Disinheritance Language', field: 'additional_disinheritance_language' },
    ],
  },
  {
    page: 'Page 4 — Guardian Designations',
    questions: [
      { question: 'Guardian — first nominee', field: 'guardian_primary' },
      { question: 'Guardian — co-guardian', field: 'guardian_co' },
      { question: 'Guardian — alternate', field: 'guardian_alt1' },
      { question: 'Guardian — alternate co-guardian', field: 'guardian_alt1_co' },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Trustee Provisions',
    questions: [
      {
        question: 'Trustee Compensation',
        field: 'trust_details.trustee_compensation',
        options: {
          prevailing_corporate: 'Prevailing rate for corporate trustees',
          prevailing_professional: 'Prevailing rate for professional fiduciaries',
          reasonable: 'Reasonable compensation (time and effort)',
          based_on_trustee_type: 'Based on trustee type',
          none: 'No compensation',
        },
      },
      { question: 'Require bond for trustee and executor', field: 'trust_details.require_trustee_bond' },
      { question: "Limit trustee's duty to account", field: 'trust_details.limit_duty_to_account' },
      { question: 'Protect U.S. trust status', field: 'trust_details.protect_us_trust_status' },
      { question: 'Allow Special Trustee', field: 'trust_details.allow_special_trustee' },
      { question: 'Special Trustee Instructions', field: 'trust_details.special_trustee_instructions' },
      { question: 'Include reverse mortgage clause', field: 'trust_details.include_reverse_mortgage_clause' },
      { question: 'Include firearms administration provisions', field: 'trust_details.include_firearms_provisions' },
      { question: 'Power to manage §529 educational savings plans', field: 'trust_details.power_529_plans' },
      { question: 'Power to manage farms and ranches', field: 'trust_details.power_farms_ranches' },
      { question: 'Power to manage closely held businesses', field: 'trust_details.power_closely_held_businesses' },
      { question: 'Power to manage professional corporations', field: 'trust_details.power_professional_corporations' },
      { question: 'Subchapter S stock provisions', field: 'trust_details.subchapter_s_provisions' },
      { question: 'Allow trustee to change situs', field: 'trust_details.allow_trustee_change_situs' },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Trust Protector',
    questions: [
      { question: 'Include provisions for a Trust Protector', field: 'trust_protector' },
      { question: 'Trust Protector', field: 'trust_protector_name' },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Retirement Accounts',
    questions: [
      {
        question: 'Include provisions for distributing retirement accounts',
        field: 'trust_details.include_retirement_account_provisions',
      },
      {
        question: 'Allow Trust Protector to convert conduit retirement trusts',
        field: 'trust_details.allow_protector_convert_conduit_trusts',
      },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Special Distributions',
    questions: [
      { question: 'Special Distributions Age', field: 'trust_details.special_distributions_age' },
      {
        question: 'Allow trustee to hold distributions to young beneficiaries in a separate trust',
        field: 'trust_details.hold_distributions_for_young_beneficiaries',
      },
      {
        question: 'Allow direct distributions to young or incapacitated beneficiaries',
        field: 'trust_details.allow_direct_distributions_to_young_or_incapacitated',
      },
      { question: 'Include substance abuse provisions', field: 'trust_details.include_substance_abuse' },
      {
        question: 'Include creditor claims and divorce provisions',
        field: 'trust_details.include_creditor_divorce_provisions',
      },
      { question: 'Include slayer provision', field: 'trust_details.include_slayer_provision' },
      {
        question: 'Include marital deduction savings language in spendthrift clause',
        field: 'trust_details.include_marital_deduction_savings_language',
      },
      {
        question: 'Include contingent special needs trust provisions',
        field: 'trust_details.include_contingent_snt',
      },
      {
        question: 'Allow trustee to make distributions to dependents during settlor incapacity',
        field: 'trust_details.allow_distributions_to_dependents_if_incapacitated',
      },
      {
        question: 'Allow trustee to continue customary charitable giving during incapacity',
        field: 'trust_details.allow_charitable_giving_during_incapacity',
      },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Administrative Provisions',
    questions: [
      {
        question: 'Include a no-contest clause in the trust and pour-over will',
        field: 'trust_details.include_no_contest_clause',
      },
      {
        question: "Name specific people in the no-contest clause",
        field: 'trust_details.name_people_in_no_contest_clause',
      },
      {
        question: 'Require mandatory arbitration for trust disputes',
        field: 'trust_details.require_mandatory_arbitration',
      },
      {
        question: 'Estate tax payment',
        field: 'trust_details.prorate_estate_taxes',
        options: {
          true: 'Apportion among beneficiaries',
          false: 'Pay from the trust before distribution',
        },
      },
      {
        question: 'Representation Type',
        field: 'trust_details.representation_type',
        options: {
          by_representation: 'By right of representation',
          per_stirpes: 'Per stirpes',
          per_capita_each_generation: 'Per capita at each generation',
        },
      },
      { question: 'Survivorship Requirement', field: 'trust_details.survivorship_requirement_days' },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Definitions',
    questions: [
      {
        question: 'Include detailed definition of discretionary distributions',
        field: 'trust_details.include_discretionary_distribution_definition',
      },
      {
        question: 'Include detailed definition of education expenses',
        field: 'trust_details.include_education_expenses_definition',
      },
      { question: 'Include arts education', field: 'trust_details.include_arts_education' },
      { question: 'Include vocational training', field: 'trust_details.include_vocational_training' },
      { question: 'Include homeschooling', field: 'trust_details.include_homeschooling' },
      { question: 'Include definition of disappearance', field: 'trust_details.include_disappearance_definition' },
    ],
  },
  {
    page: 'Page 5 — Living Trust Details',
    group: 'Incapacity',
    questions: [
      { question: 'Include definition of incapacity', field: 'trust_details.include_incapacity_definition' },
      {
        question: 'Allow clinical psychologist to substitute for physician',
        field: 'trust_details.allow_psychologist_substitute',
      },
      {
        question: 'Allow physician assistant or nurse practitioner to substitute for physician',
        field: 'trust_details.allow_pa_np_substitute',
      },
      {
        question: 'Incapacity of a settlor determined by',
        field: 'trust_details.settlor_incapacity_determined_by',
        options: INCAPACITY_DETERMINERS,
      },
      {
        question: 'Incapacity of a currently-acting trustee determined by',
        field: 'trust_details.trustee_incapacity_determined_by',
        options: INCAPACITY_DETERMINERS,
      },
    ],
  },
  {
    page: 'Page 6 — Successor Trustees',
    questions: [
      {
        question: 'If either trust ever has co-trustees, how should they decide?',
        field: 'trust_details.co_trustee_decision',
        options: {
          joint_majority: 'Co-trustees must act jointly (majority controls)',
          independent: 'Co-trustees may act separately (single signature sufficient)',
          omit: 'Do not include (silent)',
          settlor_separate_others_joint: 'Settlor may act separately; other co-trustees jointly',
        },
      },
      { question: 'Initial Co-Trustee', field: 'trustee_co' },
      { question: 'First Successor Trustee(s)', field: 'trustee_primary' },
      { question: 'Second Successor Trustee(s)', field: 'trustee_alt1' },
      { question: 'Second Successor Trustee(s) — co-trustee', field: 'trustee_alt1_co' },
      { question: 'Further Successor Trustee', field: 'trustee_alt2' },
      {
        question: 'Allow a sole acting trustee to appoint co-trustees',
        field: 'trust_details.allow_sole_trustee_to_appoint_cotrustees',
      },
      {
        question: 'Allow an acting trustee to designate alternate successor trustees',
        field: 'trust_details.allow_trustee_to_designate_alternates',
      },
      {
        question: 'Successor Trustee Vacancy',
        field: 'trust_details.successor_trustee_vacancy',
        options: {
          income_beneficiaries_any: 'Majority of income beneficiaries may appoint any successor trustee',
          income_beneficiaries_professional:
            'Majority of income beneficiaries may appoint a professional fiduciary or corporate trustee only',
          resigning_neutral: 'Resigning trustee may appoint any neutral and disinterested party',
          resigning_professional:
            'Resigning trustee may appoint a professional fiduciary or corporate trustee only',
          settlor_or_court: 'Only the settlor(s) may appoint; if unable, court petition',
        },
      },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Revocable Living Trust Information',
    questions: [
      { question: 'Trust Name', field: 'trust_name' },
      { question: "Second Settlor's Trust Name", field: 'spouse_trust_name' },
      { question: 'Is this a restatement of an existing trust?', field: 'restatement' },
      { question: 'Trust date', field: 'trust_date' },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Care of Pets',
    questions: [
      {
        question: 'Include a pet trust',
        field: 'pet_care_option',
        options: {
          omit: 'No pet trust',
          direct_bequest: 'Direct bequest to a caretaker (no pet trust)',
          pet_trust: 'Include a pet trust',
        },
      },
      { question: 'Pet care details', field: 'pet_care_details' },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Gifts, Debts & Advancements',
    questions: [
      { question: 'Does the client wish to make a gift upon their death?', field: 'specific_bequests' },
      { question: 'Forgive all debts owed by any beneficiary', field: 'trust_details.forgive_all_debts' },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Tangible Personal Property',
    questions: [
      { question: 'Remainder of Tangible Personal Property', field: 'tangible_property_distribution' },
      { question: 'Tangible personal property — named individual', field: 'tangible_property_named_individual' },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Distribution to Spouse/Partner',
    questions: [
      {
        question: 'Distribution to Spouse/Partner',
        field: 'decisions.trust_planning_type',
        options: {
          outright_to_spouse: 'Distribute outright',
          in_trust_for_spouse: 'Distribute in trust',
          disclaimer: 'Distribute in trust (disclaimer structure)',
          clayton_election: 'Distribute in trust (Clayton election)',
          not_to_spouse: 'Do not distribute to spouse/partner',
        },
      },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Trust(s) for Spouse',
    appliesTo: dividesAtFirstDeath,
    questions: [
      {
        question: 'Type of Marital Trust',
        field: 'trust_details.marital_trust',
        options: {
          qtip: 'QTIP (Qualified Terminable Interest Property Trust)',
          general_power_of_appointment: 'General Power of Appointment Trust',
          none: 'No Marital Trust',
        },
      },
      {
        question: 'Marital Trust Invasion Powers',
        field: 'trust_details.marital_trust_invasion',
        options: {
          no_invasion: 'No Invasion',
          hems: 'Invasion for HEMS',
          five_by_five: '"5 by 5" Invasion Power',
          complete: 'Complete Invasion Power',
        },
      },
      {
        question: 'QTIP Remainder Power of Appointment',
        field: 'trust_details.marital_trust_remainder_power',
        options: REMAINDER_POWER,
      },
      { question: 'Include QDOT language', field: 'trust_details.marital_trust_include_qdot' },
      {
        question: 'Type of Bypass Trust',
        field: 'trust_details.bypass_trust',
        options: {
          bypass: 'Bypass/Credit-Shelter Trust',
          disclaimer: 'Disclaimer Trust',
          none: 'No Bypass Trust',
        },
      },
      {
        question: 'Bypass Trust Formula',
        field: 'trust_details.bypass_trust_formula',
        options: {
          all_assets: 'All Assets',
          formula: 'Formula',
          fixed_amount: 'Fixed Amount',
          percentage: 'Percentage',
          clayton_election: 'Clayton Election',
        },
      },
      { question: 'Bypass Trust — Fixed Amount', field: 'trust_details.bypass_trust_fixed_amount' },
      { question: 'Bypass Trust — Percentage', field: 'trust_details.bypass_trust_percentage' },
      {
        question: 'Bypass Trust Power of Appointment',
        field: 'trust_details.bypass_trust_remainder_power',
        options: REMAINDER_POWER,
      },
      {
        question: 'Should the Bypass Trust sprinkle to children/grandchildren?',
        field: 'trust_details.bypass_trust_allow_sprinkling',
      },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Distributions',
    questions: [
      { question: 'Use Family Pot Trust', field: 'trust_details.include_common_trust_for_children' },
      {
        question: "How should the estate be distributed on the settlor's death?",
        field: 'trust_details.residuary_after_death',
        options: {
          descendants_outright_per_stirpes: 'Children Only – Outright in Equal Shares',
          descendants_shares_outright_children_trusts_others:
            'Children Only – Custom Distributions per Child',
          descendants_shares_all_trusts: 'Children Only – Equal Division into Separate Share Trusts',
          named_beneficiaries_separate_terms:
            'Children and/or Other Beneficiaries – Custom Distributions per Beneficiary',
        },
      },
      {
        question: 'Distribution method for children',
        field: 'trust_details.residual_beneficiary_method',
        options: {
          outright: 'Outright',
          staggered: 'Staggered distribution ages',
          trust_for_life: 'Held in trust for lifetime',
          custom: 'Custom distribution schedule',
        },
      },
      { question: 'Distribution age', field: 'distribution_age' },
      { question: 'Staggered distribution — first age', field: 'stagger_age_1' },
      { question: 'Staggered distribution — first percentage', field: 'stagger_pct_1' },
      { question: 'Staggered distribution — second age', field: 'stagger_age_2' },
      { question: 'Staggered distribution — second percentage', field: 'stagger_pct_2' },
      { question: 'Staggered distribution — final age', field: 'stagger_age_3' },
    ],
  },
  {
    page: 'Pages 7 & 8 — Trust for Settlor',
    group: 'Default Provision',
    questions: [
      {
        question: 'Default Provision',
        field: 'remote_beneficiary',
        options: {
          heirs_at_law: 'Heirs at Law',
          half_heirs_spouse: "Half to each settlor's heirs at law",
          named: 'Specific Individual/Group',
        },
      },
    ],
  },
  {
    page: 'Page 9 — Asset Schedules',
    questions: [
      {
        question: "Include signature block on each settlor's Schedule A",
        field: 'trust_details.asset_schedule_signature_block',
      },
      {
        question: "Include general catchall language on each settlor's Schedule A",
        field: 'trust_details.asset_schedule_catchall',
      },
      {
        question: 'Include a schedule of non-trust assets for each settlor',
        field: 'trust_details.asset_schedule_non_trust',
      },
      {
        question: 'Format for asset schedules',
        field: 'trust_details.asset_schedule_format',
        options: { table: 'Assets in table format', paragraph: 'Assets in paragraph format' },
      },
      { question: 'Schedule of Assets', field: 'assets' },
    ],
  },
  {
    page: 'Page 10 — PoA Provisions',
    questions: [
      { question: 'Include Notice Page', field: 'dpoa_provisions.include_notice_page' },
      {
        question: 'Preserve any existing bank and institutional powers of attorney',
        field: 'dpoa_provisions.preserve_existing_bank_powers',
      },
      {
        question: 'Compensation for Agents',
        field: 'dpoa_provisions.agent_compensation',
        options: {
          prevailing_professional: 'Prevailing rate for professional fiduciaries',
          reasonable: 'Reasonable compensation',
          none: 'No compensation',
        },
      },
      {
        question: 'Should co-agents serve jointly, separately, or should the document be silent?',
        field: 'dpoa_provisions.coagent_serving',
        options: {
          jointly: 'Co-agents must act jointly (unanimous)',
          separately: 'Co-agents may act separately',
          silent: 'Do not include (silent)',
        },
      },
      {
        question: 'Acceptance of Agent Signature Page',
        field: 'dpoa_provisions.acceptance_of_appointment',
        options: {
          include: 'Include Acceptance of Appointment',
          omit: 'Do Not Include Acceptance of Appointment',
        },
      },
      { question: 'Allow gifts', field: 'dpoa_provisions.allow_gifts' },
      { question: 'Agent may create trusts for the principal', field: 'dpoa_provisions.agent_may_create_trusts' },
      {
        question: 'Agent may create trusts for dependents',
        field: 'dpoa_provisions.agent_may_create_trusts_for_dependents',
      },
      { question: 'Allow agent to be trustee of a trust they create', field: 'dpoa_provisions.allow_agent_as_trustee' },
      {
        question: 'Agent may create Medicaid planning trusts',
        field: 'dpoa_provisions.agent_may_create_medicaid_trusts',
      },
      {
        question: 'Agent may modify sole-settlor trusts',
        field: 'dpoa_provisions.agent_may_modify_sole_settlor_trusts',
      },
      { question: 'Agent may modify joint trusts', field: 'dpoa_provisions.agent_may_modify_joint_trusts' },
      { question: 'Allow delegation of authority to professionals', field: 'dpoa_provisions.allow_delegation' },
      { question: 'Prohibit arbitration', field: 'dpoa_provisions.prohibit_arbitration' },
      { question: 'Power to manage §529 educational savings plans', field: 'dpoa_provisions.power_529_plans' },
      {
        question: 'Allow agent to access medical information',
        field: 'dpoa_provisions.allow_medical_information_access',
      },
      { question: 'Power to control digital assets and devices', field: 'dpoa_provisions.power_digital_assets' },
      {
        question: 'Allow self-designation for beneficiary designations',
        field: 'dpoa_provisions.allow_self_designation_beneficiary',
      },
    ],
  },
  {
    page: 'Pages 11 & 12 — Power of Attorney',
    questions: [
      {
        question: 'When should the power of attorney be effective?',
        field: 'dpoa_provisions.effective',
        options: { springing: 'Springing (authority begins on incapacity)', immediate: 'Immediate' },
      },
      { question: 'First Attorney-in-Fact(s)', field: 'poa_primary' },
      { question: 'Attorney-in-Fact co-agent', field: 'poa_co' },
      { question: 'Backup Attorney-in-Fact(s)', field: 'poa_alt1' },
      { question: 'Basic Powers — all powers in this list', field: 'dpoa_provisions.all_basic_powers' },
      { question: 'Real property transactions', field: 'dpoa_provisions.basic_powers.real_property' },
      {
        question: 'Tangible personal property transactions',
        field: 'dpoa_provisions.basic_powers.tangible_personal_property',
      },
      { question: 'Stock and bond transactions', field: 'dpoa_provisions.basic_powers.stocks_bonds' },
      { question: 'Commodity and option transactions', field: 'dpoa_provisions.basic_powers.commodities_options' },
      {
        question: 'Banking and other financial institution transactions',
        field: 'dpoa_provisions.basic_powers.banking',
      },
      { question: 'Business operating transactions', field: 'dpoa_provisions.basic_powers.business_operating' },
      { question: 'Insurance and annuity transactions', field: 'dpoa_provisions.basic_powers.insurance_annuity' },
      {
        question: 'Estate, trust, and other beneficiary transactions',
        field: 'dpoa_provisions.basic_powers.estate_trust_beneficiary',
      },
      { question: 'Claims and litigation', field: 'dpoa_provisions.basic_powers.claims_litigation' },
      {
        question: 'Personal and family maintenance',
        field: 'dpoa_provisions.basic_powers.personal_family_maintenance',
      },
      { question: 'Government and civil/military service benefits', field: 'dpoa_provisions.basic_powers.government_benefits' },
      { question: 'Retirement plan transactions', field: 'dpoa_provisions.basic_powers.retirement_plans' },
      { question: 'Tax matters', field: 'dpoa_provisions.basic_powers.tax_matters' },
      { question: 'Additional Powers', field: 'dpoa_provisions.additional_powers' },
      { question: 'Name Specific Businesses', field: 'dpoa_provisions.specific_businesses' },
      { question: 'Additional Limitations', field: 'dpoa_provisions.additional_limitations' },
    ],
  },
  {
    page: 'Pages 13 & 14 — Health Care Proxy',
    questions: [
      { question: 'Include Notice Page', field: 'healthcare_provisions.include_hcp_notice_page' },
      {
        question: 'Leave health care instructions blank',
        field: 'healthcare_provisions.client_leave_instructions_blank',
      },
      {
        question: 'Medical Treatment for Advanced Illness',
        field: 'healthcare_provisions.client_advance_directive',
        options: {
          prolong_life: 'Prolong life',
          do_not_resuscitate: 'Prolong life, but no CPR or mechanical ventilation',
          do_not_prolong_life: 'Do Not Prolong Life (comfort care only)',
          other: 'Other / Custom Instructions',
        },
      },
      { question: 'Other / Custom Instructions', field: 'healthcare_provisions.client_advance_directive_other' },
      { question: 'Receive hygiene and comfort care', field: 'healthcare_provisions.client_receive_comfort_care' },
      {
        question: 'Wish to die at home rather than in a hospital or nursing home',
        field: 'healthcare_provisions.client_wish_to_die_at_home',
      },
      { question: 'Decline autopsy if not legally required', field: 'healthcare_provisions.client_decline_autopsy' },
      {
        question: 'Anatomical gifts preference',
        field: 'healthcare_provisions.client_anatomical_gift',
        options: {
          yes: 'Yes, make anatomical gifts',
          defer: 'Defer to healthcare agent or donor registry',
          no: 'No, do not make anatomical gifts',
        },
      },
      { question: 'Other Healthcare Wishes', field: 'healthcare_provisions.client_other_healthcare_wishes' },
      {
        question: "Should the agent's authority be effective immediately?",
        field: 'healthcare_provisions.client_agent_effective_immediately',
      },
      {
        question: 'Include post-death authority and instructions for final disposition',
        field: 'healthcare_provisions.client_include_post_death_authority',
      },
      {
        question: "Limitations on agent's authority while living",
        field: 'healthcare_provisions.client_agent_limits_while_living',
      },
      {
        question: "Limitations on agent's authority after death",
        field: 'healthcare_provisions.client_agent_limits_after_death',
      },
      { question: 'First Agent', field: 'hcp_primary' },
      { question: 'Co-agent', field: 'hcp_co' },
      { question: 'Backup Agent(s)', field: 'hcp_alt1' },
      { question: 'Backup co-agent', field: 'hcp_alt1_co' },
      {
        question: 'How should co-agents resolve disagreements?',
        field: 'healthcare_provisions.client_coagent_disagreement_resolution',
        options: {
          omit: 'Do not include (silent)',
          majority: 'Majority rules',
          unanimous: 'Unanimous agreement required',
          first_named: 'First-named agent has final authority',
        },
      },
    ],
  },
  {
    page: 'Pages 17 & 18 — Healthcare Forms',
    group: 'HIPAA Authorization',
    questions: [
      {
        question: 'Include the general (financial) durable power of attorney in the HIPAA authorization',
        field: 'healthcare_provisions.hipaa_include_poa',
      },
      {
        question: 'Include trustee and successor trustees in the HIPAA authorization',
        field: 'healthcare_provisions.hipaa_include_trustees',
      },
      {
        question: 'List fiduciaries by name in the HIPAA authorization?',
        field: 'healthcare_provisions.hipaa_list_fiduciaries_by_name',
        options: { by_name: 'List fiduciaries by name', general_language: 'Use general language only' },
      },
    ],
  },
  {
    page: 'Pages 21 & 22 — Will & Executors',
    questions: [
      { question: 'Make executors the same as the trustees', field: 'executor_same_as_trustee' },
      {
        question: 'Make executors the same as the trustees (second settlor)',
        field: 'spouse_executor_same_as_trustee',
      },
      { question: 'First executor', field: 'executor_primary' },
      { question: 'Co-executor', field: 'executor_co' },
      { question: 'Alternate executor', field: 'executor_alt1' },
      { question: 'Alternate co-executor', field: 'executor_alt1_co' },
      {
        question: 'Allow executor to pay taxes, debts, and expenses from the probate estate',
        field: 'will_pr_powers.allow_pay_taxes_debts_expenses',
      },
      {
        question: 'Allow executor to manage digital assets',
        field: 'will_pr_powers.allow_manage_digital_assets',
      },
      {
        question: 'Include "Distribution in Cash or Kind" power',
        field: 'will_pr_powers.include_distribution_cash_or_kind',
      },
      {
        question: 'Exercise a testamentary power of appointment',
        field: 'will_provisions.exercise_testamentary_power_of_appointment',
      },
      {
        question: 'Exercise a testamentary power of appointment (second settlor)',
        field: 'will_provisions.spouse_exercise_testamentary_power_of_appointment',
      },
    ],
  },
  {
    page: 'Page 25 — Signing Information',
    questions: [
      {
        question: 'Acknowledgment of Trust',
        field: 'execution_mechanics.trust_acknowledgment',
        options: ACKNOWLEDGMENT,
      },
      {
        question: 'Combine settlor and trustee signatures',
        field: 'execution_mechanics.combine_settlor_trustee_signatures',
      },
      {
        question: 'Acknowledgment of Power of Attorney',
        field: 'execution_mechanics.poa_acknowledgment',
        options: ACKNOWLEDGMENT,
      },
      {
        question: 'Acknowledgment of Advance Health Care Directive',
        field: 'execution_mechanics.ahd_acknowledgment',
        options: ACKNOWLEDGMENT,
      },
      {
        question: 'Acknowledgment of Healthcare Authorizations',
        field: 'execution_mechanics.healthcare_authorization_acknowledgment',
        options: ACKNOWLEDGMENT,
      },
      {
        question: 'Will the healthcare directive be signed in a nursing home?',
        field: 'execution_mechanics.healthcare_signed_in_nursing_home',
      },
      { question: 'Include a Self-Proving Affidavit with the Will', field: 'include_self_proving_affidavit' },
      { question: 'Signing State', field: 'state' },
      { question: 'Signing County', field: 'signing_county' },
      { question: 'Signing City', field: 'execution_mechanics.signing_city' },
      { question: 'Full Name of Notary', field: 'execution_mechanics.notary_name' },
      { question: 'Include Witness Phones', field: 'execution_mechanics.include_witness_phones' },
      { question: 'First Witness Address', field: 'execution_mechanics.witness_1_address' },
      { question: 'First Witness Phone', field: 'execution_mechanics.witness_1_phone' },
      { question: 'Second Witness Address', field: 'execution_mechanics.witness_2_address' },
      { question: 'Second Witness Phone', field: 'execution_mechanics.witness_2_phone' },
      { question: 'Signing Date', field: 'signing_date' },
      { question: 'Notary commission expiration', field: 'notary_commission_expiration' },
    ],
  },
]

/** Every design-sheet field the map already places on a Statular question. */
export const STATULAR_MAPPED_FIELDS: ReadonlySet<string> = new Set(
  STATULAR_INTERVIEW.flatMap(group => group.questions.map(question => question.field)),
)
