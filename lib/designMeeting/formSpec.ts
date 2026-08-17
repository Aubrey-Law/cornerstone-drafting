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
      'street',
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
    intro: 'Close the meeting here. Anything unresolved belongs in concerns, not in a guess.',
    fields: [
      'goals_notes',
      'concerns',
      'drafting_notes',
    ],
    prompts: [
      'Signing county (defaults to Norfolk — Needham office)',
      'Target signing date',
    ],
  },
]

/** Every registry field the meeting form names, in worksheet order. */
export function designMeetingFieldNames(): string[] {
  return DESIGN_MEETING_SECTIONS.flatMap(section => section.fields)
}
