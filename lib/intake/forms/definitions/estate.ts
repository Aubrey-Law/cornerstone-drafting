import type { IntakeFormDefinition } from '../types'

/** The existing estate questionnaire, composed exclusively from approved catalogs. */
export const ESTATE_INTAKE_FORM: IntakeFormDefinition = {
  schemaVersion: 1,
  key: 'estate',
  title: 'Estate Plan Organizer',
  sections: [
    {
      id: 'referral', title: 'Getting Started', subtitle: 'How did you find us?', timeEstimateMinutes: 1, optional: true, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'referral_source', fieldId: 'referral_source' },
        { kind: 'field', id: 'legal_insurance_plan', fieldId: 'legal_insurance_plan', condition: { op: 'equals', fieldId: 'referral_source', value: 'Legal Insurance' } },
        { kind: 'field', id: 'legal_insurance_member_id', fieldId: 'legal_insurance_member_id', labelOverride: 'Member ID / Case Number', condition: { op: 'equals', fieldId: 'referral_source', value: 'Legal Insurance' } },
        { kind: 'field', id: 'referral_name', fieldId: 'referral_name', labelOverride: "Who referred you? We'd love to thank them!", condition: { op: 'equals', fieldId: 'referral_source', value: 'Referral' } },
      ],
    },
    {
      id: 'personal', title: 'Personal Information', subtitle: 'Name, contact & address', timeEstimateMinutes: 5, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'client_first_name', fieldId: 'client_first_name' },
        { kind: 'field', id: 'client_middle_name', fieldId: 'client_middle_name' },
        { kind: 'field', id: 'client_last_name', fieldId: 'client_last_name' },
        { kind: 'field', id: 'client_suffix', fieldId: 'client_suffix' },
        { kind: 'field', id: 'client_prior_name', fieldId: 'client_prior_name' },
        { kind: 'field', id: 'client_preferred_name', fieldId: 'client_preferred_name' },
        { kind: 'field', id: 'client_pronouns', fieldId: 'client_pronouns' },
        { kind: 'field', id: 'client_citizenship', fieldId: 'client_citizenship', labelOverride: 'Citizenship / immigration status' },
        { kind: 'field', id: 'client_email', fieldId: 'client_email' },
        { kind: 'field', id: 'client_phone', fieldId: 'client_phone' },
        { kind: 'block', id: 'address', blockId: 'address', config: { profile: 'estate', includeCounty: false } },
        { kind: 'field', id: 'client_dob', fieldId: 'client_dob' },
        { kind: 'field', id: 'county', fieldId: 'county' },
      ],
    },
    {
      id: 'family', title: 'Family', subtitle: 'Marital status & dependents', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'marital_status', fieldId: 'marital_status', requirement: 'required' },
        { kind: 'field', id: 'has_children', fieldId: 'has_children', requirement: 'required' },
        { kind: 'field', id: 'has_minor_children', fieldId: 'has_minor_children', requirement: 'required', condition: { op: 'equals', fieldId: 'has_children', value: true } },
      ],
    },
    {
      id: 'spouse', title: 'Spouse Information', subtitle: "Spouse's details", timeEstimateMinutes: 3, audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' },
      items: [{ kind: 'block', id: 'spouse_details', blockId: 'spouse_details' }],
    },
    {
      id: 'children', title: 'Children', subtitle: "Children's information", timeEstimateMinutes: 3, audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'has_children', value: true },
      items: [{ kind: 'block', id: 'children', blockId: 'children' }],
    },
    {
      id: 'estate', title: 'Financial', subtitle: 'Assets & financial overview', timeEstimateMinutes: 5, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'estate_value', fieldId: 'estate_value', labelOverride: 'Estimated Total Estate Value', requirement: 'required' },
        { kind: 'block', id: 'financial_assets', blockId: 'financial_assets' },
      ],
    },
    {
      id: 'goals', title: 'Goals & Wishes', subtitle: 'Priorities & special wishes', timeEstimateMinutes: 4, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'planning_goals', fieldId: 'planning_goals', requirement: 'required' },
        { kind: 'block', id: 'planning_objectives', blockId: 'planning_objectives' },
        { kind: 'block', id: 'existing_document_uploads', blockId: 'existing_document_uploads' },
        { kind: 'field', id: 'special_notes', fieldId: 'special_notes' },
      ],
    },
    {
      id: 'additional_contacts', title: 'Additional Contacts', subtitle: 'Other people you may name as fiduciaries (optional)', timeEstimateMinutes: 3, optional: true, audience: 'client_and_staff',
      items: [{ kind: 'block', id: 'additional_contacts', blockId: 'additional_contacts' }],
    },
    {
      id: 'fiduciaries', title: 'Your Fiduciaries', subtitle: 'Trustees, agents & proxies', timeEstimateMinutes: 7, audience: 'client_and_staff',
      items: [{ kind: 'block', id: 'client_fiduciaries', blockId: 'client_fiduciaries' }],
    },
    {
      id: 'spouse_fiduciaries', title: "Spouse's Fiduciaries", subtitle: "Spouse's trustees & agents", timeEstimateMinutes: 5, audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' },
      items: [{ kind: 'block', id: 'spouse_fiduciaries', blockId: 'spouse_fiduciaries' }],
    },
    {
      id: 'guardian', title: 'Guardian for Minors', subtitle: 'Care for minor children', timeEstimateMinutes: 2, audience: 'client_and_staff', condition: { op: 'all', conditions: [{ op: 'not_equals', fieldId: 'has_children', value: false }, { op: 'equals', fieldId: 'has_minor_children', value: true }] },
      items: [{ kind: 'block', id: 'guardian', blockId: 'guardian' }],
    },
    {
      id: 'review', title: 'Review & Submit', subtitle: 'Confirm & submit', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [{ kind: 'block', id: 'review_submit', blockId: 'review_submit' }],
    },
  ],
}
