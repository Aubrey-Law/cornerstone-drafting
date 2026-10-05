/**
 * What a design meeting actually decides.
 *
 * The full proposable set is ~195 fields. A form that size cannot be worked
 * through at a table with a client, and mostly comes back blank — so this is a
 * curated subset covering the decisions a design meeting really makes, with the
 * long tail of provisions left to the firm's saved standards and to autofill.
 *
 * Fields are named here; their labels and option lists deliberately are NOT.
 * Those are resolved at build time through `getDesignSheetImportFieldMeta`, so
 * the worksheet always prints the same option tokens the import validator will
 * accept. Duplicating them here is how the form would drift into producing
 * values that silently land in `rejected`.
 *
 * Fiduciary names are not in this list. The fiduciary proposer reads people out
 * of prose (FIDUCIARY_SYSTEM_PROMPT in lib/designSheetCompletion/engine.ts)
 * rather than out of the field map, so they are captured as free-text prompts —
 * see FIDUCIARY_PROMPTS below.
 */

export interface DesignMeetingSection {
  title: string
  /** Shown under the heading on the worksheet and as the checklist's framing. */
  intro: string
  /** Registry field names — column names or `<namespace>.<key>`. */
  fields: string[]
  /** Free-text lines with no backing field, for people and open questions. */
  prompts?: string[]
}

/**
 * Roles worth naming on paper. Kept to the ones a first design meeting settles;
 * co-agents and second alternates are usually a follow-up.
 */
export const FIDUCIARY_PROMPTS = [
  'Trustee — primary',
  'Trustee — alternate',
  'Trustee — second alternate',
  'Personal representative — primary',
  'Personal representative — alternate',
  'Attorney-in-fact (financial POA) — primary',
  'Attorney-in-fact (financial POA) — alternate',
  'Health care agent — primary',
  'Health care agent — alternate',
  'Guardian for minor children — primary',
  'Guardian for minor children — alternate',
] as const

export const DESIGN_MEETING_SECTIONS: DesignMeetingSection[] = [
  {
    title: 'Client & Spouse',
    intro: 'Confirm what intake already captured. Correct anything that has changed.',
    fields: [
      'client_name',
      'client_dob',
      'client_aka',
      'marital_status',
      'spouse_name',
      'spouse_dob',
      'spouse_aka',
      'marriage_date',
      // Two of Phase 5's settlor facts belong on paper because they are things
      // you confirm at the table. The rest — gender, survivor designation,
      // disabled-veteran status, whether the settlors live together — are left
      // to autofill and the design sheet, per this file's opening note about
      // not growing the form past what a meeting can work through.
      'settlor_facts.place_of_marriage',
      'street',
      'settlor_facts.street_address_2',
      'city',
      'state',
      'zip',
      'county',
    ],
  },
  {
    title: 'Family & Guardians',
    intro: 'Children by full legal name. Guardians matter only where a child is a minor.',
    fields: [
      'excluded_guardian_flag',
      'excluded_guardian_name',
    ],
    prompts: [
      'Children (full legal name, date of birth, minor or adult)',
      'Anyone deliberately left out, and why',
    ],
  },
  {
    title: 'Plan Type',
    intro: 'The shape of the plan. Everything downstream follows from this.',
    fields: [
      'plan_type',
      'is_joint',
      'trust_name',
      'spouse_trust_name',
      'restatement',
    ],
  },
  {
    title: 'Fiduciaries',
    intro: 'Full legal names, and relationship where it is not obvious.',
    fields: [
      'executor_same_as_trustee',
      'poa_same_as_trustee',
    ],
    prompts: [...FIDUCIARY_PROMPTS],
  },
  {
    title: 'Distribution',
    intro: 'How and when the residuary reaches the beneficiaries.',
    fields: [
      'trust_details.residual_beneficiary_method',
      'trust_details.residuary_after_death',
      'trust_details.representation_type',
      'distribution_age',
      'stagger_age_1',
      'stagger_pct_1',
      'stagger_age_2',
      'stagger_pct_2',
      'stagger_age_3',
      'remote_beneficiary',
      'tangible_property_distribution',
    ],
  },
  {
    title: 'Will Provisions',
    intro: 'Standing choices. Most matters take the firm default unless the client raises something.',
    fields: [
      'bond',
      'supervision',
      'no_contest_clause',
      'utma_age',
      'simultaneous_death',
      'pet_care_option',
    ],
    prompts: [
      'Specific bequests (who receives what, and from the will or the trust)',
    ],
  },
  {
    title: 'Health Care',
    intro: 'The client’s own elections. Never presumed from the firm’s standards.',
    fields: [
      'healthcare_provisions.client_advance_directive',
      'healthcare_provisions.client_anatomical_gift',
      'healthcare_provisions.spouse_advance_directive',
      'healthcare_provisions.spouse_anatomical_gift',
    ],
  },
  {
    title: 'Signing & Notes',
    intro: 'Close the meeting here. Signing county is usually Norfolk (Needham office). Anything unresolved belongs in concerns, not in a guess.',
    fields: [
      'signing_county',
      'signing_date',
      'goals_notes',
      'concerns',
      'drafting_notes',
    ],
  },
]

/**
 * What a Peace of Mind Planning Session (PMPS) has to come away with.
 *
 * The PMPS is the first consultation: it is where the facts are gathered and
 * the shape of the plan is proposed, not where provisions are decided. So this
 * leans on facts — who is in the family, what the estate holds, what the
 * client is worried about — and on the handful of choices the proposal and the
 * Massachusetts estate-tax worksheet cannot be written without. The provisions
 * are left to the design meeting, which picks up from whatever this captured.
 *
 * Assets and children are captured as free text under the registry's `assets`
 * and `children` fields; the extractor turns the prose into rows. The prompts
 * under each name the details the PMPS preflight
 * (tools/workflows/system/assistant/pmps-proposal-preflight/SKILL.md) reports
 * missing most often — policy ownership above all.
 *
 * Billing has no design-sheet field. It is asked here because the proposal
 * cannot be generated without it, and it lands in drafting notes until someone
 * records it on the matter.
 */
export const PMPS_SECTIONS: DesignMeetingSection[] = [
  {
    title: 'Clients',
    intro: 'Full legal names as they should appear on the documents. Citizenship and county are not optional.',
    fields: [
      'client_name',
      'client_dob',
      'client_citizenship',
      'client_phone',
      'client_email',
      'marital_status',
      'spouse_name',
      'spouse_dob',
      'spouse_citizenship',
      'marriage_date',
      'street',
      'city',
      'state',
      'zip',
      'county',
      'settlor_facts.disabled_veteran',
    ],
    prompts: [
      'First name each client goes by',
    ],
  },
  {
    title: 'Family',
    intro: 'Every child by full legal name and exact date of birth. A birth year alone is not enough.',
    fields: [
      'children',
    ],
    prompts: [
      'Child from a prior relationship',
      'Child with special needs or receiving benefits',
      'Deceased child with descendants',
      'Anyone the client intends to leave out, and why',
    ],
  },
  {
    title: 'Assets & Estate Tax',
    intro: 'Every line needs a number. A blank is not zero — it stops the estate-tax worksheet reconciling.',
    fields: [
      'assets',
    ],
    prompts: [
      'Real property (address, value, mortgage balance, how titled; flag anything outside Massachusetts)',
      'Bank and brokerage accounts (institution, approximate value, owner)',
      'Retirement accounts (type, institution, value, current beneficiary)',
      'Life insurance (carrier, death benefit, term or whole, who OWNS the policy, beneficiary)',
      'Business interests (entity, percent owned, valuation basis)',
      'Other assets (vehicles, digital assets, collectibles, money owed to the client)',
      'Are these values per spouse or combined',
      'Prior taxable gifts',
      'Anticipated inheritance (source and expected amount)',
    ],
  },
  {
    title: 'Goals & Concerns',
    intro: 'In the client’s own words. This is what the proposal is written to.',
    fields: [
      'goals_notes',
      'concerns',
    ],
    prompts: [
      'What prompted the call now',
      'Asset-protection worries (divorce, creditors, a spendthrift beneficiary)',
      'Incapacity or long-term-care worries',
      'Pets (name, and who would care for them)',
    ],
  },
  {
    title: 'Proposed Plan',
    intro: 'The recommendation made at the table. Mark anything the client has not agreed to as "not decided".',
    fields: [
      'plan_type',
      'is_joint',
      'trust_details.residual_beneficiary_method',
      'distribution_age',
      'stagger_age_1',
      'stagger_pct_1',
      'stagger_age_2',
      'stagger_pct_2',
      'stagger_age_3',
    ],
    prompts: [
      'Joint trust or separate mirror trusts',
      'Credit-shelter / bypass planning discussed',
      'Discretionary standard before distribution ages (HEMS; is college called out)',
      'Contingent beneficiaries if a child predeceases (full legal names)',
    ],
  },
  {
    title: 'Fiduciaries (first thoughts)',
    intro: 'Who the client has in mind. These are confirmed at the design meeting, not here.',
    fields: [],
    prompts: [
      'Spouses serve as co-trustees',
      ...FIDUCIARY_PROMPTS,
      'Any fiduciary outside the U.S., named as a couple, or under about 25',
    ],
  },
  {
    title: 'Engagement & Next Steps',
    intro: 'What the client was quoted and what happens next.',
    fields: [
      'drafting_notes',
    ],
    prompts: [
      'Legal plan (MetLife / ARAG / LegalShield / none) and member ID',
      'Flat fee quoted, and what it covers',
      'Optional services discussed (real property transfer, advanced estate-tax planning, supervised signing)',
      'Engagement decision (hired / thinking it over / not proceeding)',
      'Documents the client will send (deeds, statements, existing plan, beneficiary forms)',
      'Design meeting date',
    ],
  },
]

/** A meeting the generator builds capture artifacts for. */
export interface MeetingSpec {
  /** File-name stem for the generated artifacts. */
  key: 'design-meeting' | 'pmps'
  /** The meeting's name as it reads in headings. */
  title: string
  sections: DesignMeetingSection[]
}

export const DESIGN_MEETING_SPEC: MeetingSpec = {
  key: 'design-meeting',
  title: 'Estate Plan Design Meeting',
  sections: DESIGN_MEETING_SECTIONS,
}

export const PMPS_SPEC: MeetingSpec = {
  key: 'pmps',
  title: 'Peace of Mind Planning Session',
  sections: PMPS_SECTIONS,
}

export const MEETING_SPECS: MeetingSpec[] = [PMPS_SPEC, DESIGN_MEETING_SPEC]

/** Every registry field a meeting form names, in worksheet order. */
export function meetingFieldNames(sections: DesignMeetingSection[]): string[] {
  return sections.flatMap(section => section.fields)
}

/** Every registry field the design-meeting form names, in worksheet order. */
export function designMeetingFieldNames(): string[] {
  return meetingFieldNames(DESIGN_MEETING_SECTIONS)
}
