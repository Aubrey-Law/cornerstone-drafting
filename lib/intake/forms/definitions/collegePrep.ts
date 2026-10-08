import type { IntakeFormDefinition } from '../types'

const livingWillCondition = { op: 'equals', fieldId: 'college_living_will_include', value: 'yes' } as const

/** Fixed college package; estate-only planning controls are deliberately absent. */
export const COLLEGE_PREP_INTAKE_FORM: IntakeFormDefinition = {
  schemaVersion: 1,
  key: 'college_prep',
  title: 'College Preparation Plan',
  description: 'Power of attorney, health care proxy, HIPAA authorization, and living will.',
  sections: [
    {
      id: 'cp_student', title: 'Student Information', subtitle: 'The student is the client — every document is signed by them', timeEstimateMinutes: 3, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'client_first_name', fieldId: 'client_first_name', labelOverride: 'First name (as it appears on government ID)', helpText: 'The student is the client. Every document in this package is signed by the student and can be revoked by the student at any time, for any reason. A parent or guardian may fill this in, but the student should review the answers before the drafting appointment.' },
        { kind: 'field', id: 'client_middle_name', fieldId: 'client_middle_name' },
        { kind: 'field', id: 'client_last_name', fieldId: 'client_last_name' },
        { kind: 'field', id: 'client_suffix', fieldId: 'client_suffix' },
        { kind: 'field', id: 'client_preferred_name', fieldId: 'client_preferred_name' },
        { kind: 'field', id: 'client_pronouns', fieldId: 'client_pronouns' },
        { kind: 'field', id: 'client_citizenship', fieldId: 'client_citizenship' },
        { kind: 'field', id: 'client_email', fieldId: 'client_email' },
        { kind: 'field', id: 'client_phone', fieldId: 'client_phone', labelOverride: 'Cell phone' },
        { kind: 'block', id: 'address', blockId: 'address', config: { profile: 'college', includeCounty: false } },
        { kind: 'field', id: 'client_dob', fieldId: 'client_dob' },
        { kind: 'field', id: 'county', fieldId: 'county' },
      ],
    },
    {
      id: 'cp_school', title: 'School Information', subtitle: 'Where the student is headed, and school records access', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'college_school_name', fieldId: 'college_school_name', labelOverride: 'College / university / program', requirement: 'required' },
        { kind: 'field', id: 'college_school_city', fieldId: 'college_school_city', labelOverride: 'Campus city', requirement: 'recommended' },
        { kind: 'field', id: 'college_school_state', fieldId: 'college_school_state', labelOverride: 'Campus state' },
        { kind: 'field', id: 'college_move_in_date', fieldId: 'college_move_in_date', labelOverride: 'Move-in / orientation date', requirement: 'recommended' },
        { kind: 'field', id: 'college_studying_abroad', fieldId: 'college_studying_abroad', labelOverride: 'The student will study or travel abroad during the program' },
        { kind: 'field', id: 'college_abroad_country', fieldId: 'college_abroad_country', labelOverride: 'Country / countries', condition: { op: 'equals', fieldId: 'college_studying_abroad', value: true } },
        { kind: 'field', id: 'college_ferpa_release', fieldId: 'college_ferpa_release', labelOverride: 'Include a FERPA release for education records', requirement: 'required', helpText: 'HIPAA covers medical information. Education records — grades, tuition, financial aid, housing, and disciplinary files — are covered by FERPA. A health care proxy does nothing for them. Once the student turns 18 those records belong to the student alone. Colleges publish their own FERPA forms; we can prepare a general authorization and tell you which school forms to file alongside it.' },
        { kind: 'field', id: 'college_ferpa_records', fieldId: 'college_ferpa_records', labelOverride: 'Which records should the release cover?', requirement: 'required', condition: { op: 'equals', fieldId: 'college_ferpa_release', value: true } },
        { kind: 'field', id: 'college_ferpa_recipients', fieldId: 'college_ferpa_recipients', labelOverride: 'Who should be able to receive education records?', helpText: 'Usually the same parents named elsewhere, but the student may choose differently.', condition: { op: 'equals', fieldId: 'college_ferpa_release', value: true } },
      ],
    },
    {
      id: 'cp_parents', title: 'Parents & Guardians', subtitle: 'Who may be named, and anything we should know', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [
        { kind: 'block', id: 'college_parents', blockId: 'college_parents' },
        { kind: 'field', id: 'college_family_circumstances', fieldId: 'college_family_circumstances' },
      ],
    },
    {
      id: 'cp_agents', title: 'Agent Designations', subtitle: 'Financial agent, health care agent, and who may receive information', timeEstimateMinutes: 4, audience: 'client_and_staff',
      items: [
        { kind: 'block', id: 'college_agents', blockId: 'college_agents' },
        { kind: 'block', id: 'college_hipaa_recipients', blockId: 'college_hipaa_recipients' },
        { kind: 'field', id: 'college_excluded_people', fieldId: 'college_excluded_people' },
      ],
    },
    {
      id: 'cp_dpoa', title: 'Power of Attorney — Scope', subtitle: 'When it takes effect and what it covers', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'college_dpoa_effective', fieldId: 'college_dpoa_effective', requirement: 'required', helpText: 'A springing power of attorney works once someone produces a physician’s written determination of incapacity. Banks and bursars are cautious, and collecting that determination takes days you may not have. An immediate power of attorney is not a transfer of control — the student keeps every right to act, and can revoke the document at any time.' },
        { kind: 'field', id: 'college_dpoa_powers', fieldId: 'college_dpoa_powers', requirement: 'recommended', condition: { op: 'not_equals', fieldId: 'college_dpoa_effective', value: 'discuss' } },
        { kind: 'field', id: 'college_dpoa_withheld', fieldId: 'college_dpoa_withheld', labelOverride: 'Powers to expressly withhold or limit', helpText: 'For example: no authority over a brokerage account, or no authority to sign a lease without speaking to the student first.' },
        { kind: 'field', id: 'college_dpoa_notes', fieldId: 'college_dpoa_notes', labelOverride: 'Notes or concerns about financial authority' },
      ],
    },
    {
      id: 'cp_healthcare', title: 'Health Care Proxy', subtitle: 'Limits and personal instructions (optional)', timeEstimateMinutes: 1, optional: true, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'college_hcp_limits', fieldId: 'college_hcp_limits', labelOverride: "Limits on the agent's authority", helpText: 'By default the health care agent may make any health care decision the student could make. Both questions in this section are optional — leave them blank if nothing comes to mind. Note anything the agent should not be able to decide alone.' },
        { kind: 'field', id: 'college_hcp_instructions', fieldId: 'college_hcp_instructions', helpText: 'Dietary requirements, observances, a preference about who is in the room, a clinician the student would want called.' },
      ],
    },
    {
      id: 'cp_hipaa', title: 'HIPAA Authorization', subtitle: 'What may be shared, and for how long', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'college_hipaa_scope', fieldId: 'college_hipaa_scope', labelOverride: 'What health information may be released?', requirement: 'required' },
        { kind: 'field', id: 'college_hipaa_excluded_categories', fieldId: 'college_hipaa_excluded_categories', labelOverride: 'Categories to withhold', requirement: 'required', condition: { op: 'equals', fieldId: 'college_hipaa_scope', value: 'all_except' } },
        { kind: 'field', id: 'college_hipaa_different_scope', fieldId: 'college_hipaa_different_scope', labelOverride: 'Different scope for different people?', helpText: 'For example: full access to one parent, emergency-only information to another.' },
        { kind: 'field', id: 'college_hipaa_expiration', fieldId: 'college_hipaa_expiration', labelOverride: 'When should the authorization expire?', requirement: 'required', helpText: 'A HIPAA authorization has to state when it ends. Most families choose no expiration — the student can revoke it at any time in writing — but you can set a date instead, such as graduation.' },
        { kind: 'field', id: 'college_hipaa_expiration_date', fieldId: 'college_hipaa_expiration_date', labelOverride: 'Expiration date', requirement: 'required', condition: { op: 'equals', fieldId: 'college_hipaa_expiration', value: 'date' } },
      ],
    },
    {
      id: 'cp_living_will', title: 'Living Will', subtitle: 'Written instructions about care', timeEstimateMinutes: 2, audience: 'client_and_staff',
      items: [
        { kind: 'field', id: 'college_living_will_include', fieldId: 'college_living_will_include', labelOverride: 'Should the package include a living will?', requirement: 'required', helpText: 'A living will is a written statement of the care the student would and would not want if they could not speak for themselves. Massachusetts does not give living wills the same statutory force as a health care proxy, but doctors and agents read them, and families rely on them. Its real value is that it takes the weight off the agent. Whoever the student names should never have to guess — or carry a decision alone that the student already made.' },
        { kind: 'field', id: 'college_life_support', fieldId: 'college_life_support', labelOverride: 'If there is no reasonable hope of recovery, what should happen?', requirement: 'required', condition: livingWillCondition },
        { kind: 'field', id: 'college_cpr', fieldId: 'college_cpr', labelOverride: 'Attempted resuscitation (CPR)', condition: livingWillCondition },
        { kind: 'field', id: 'college_artificial_nutrition', fieldId: 'college_artificial_nutrition', labelOverride: 'Artificial nutrition and hydration (feeding tube)', condition: livingWillCondition },
        { kind: 'field', id: 'college_ventilation', fieldId: 'college_ventilation', labelOverride: 'Mechanical ventilation (breathing machine)', condition: livingWillCondition },
        { kind: 'field', id: 'college_comfort_always', fieldId: 'college_comfort_always', labelOverride: 'Provide pain relief and comfort care at all times, even if it may hasten death', condition: livingWillCondition },
        { kind: 'field', id: 'college_organ_donation', fieldId: 'college_organ_donation', labelOverride: 'Would the student want to donate organs or tissue?', requirement: 'recommended', condition: livingWillCondition },
        { kind: 'field', id: 'college_organ_donation_notes', fieldId: 'college_organ_donation_notes', labelOverride: 'Which organs, tissue, or purposes?', condition: { op: 'all', conditions: [livingWillCondition, { op: 'equals', fieldId: 'college_organ_donation', value: 'specific' }] } },
        { kind: 'field', id: 'college_other_medical_notes', fieldId: 'college_other_medical_notes', labelOverride: 'Anything else the family and doctors should know' },
      ],
    },
    {
      id: 'cp_other', title: 'Other Matters', subtitle: 'Anything else we should know (optional)', timeEstimateMinutes: 1, optional: true, audience: 'client_and_staff',
      items: [{ kind: 'field', id: 'college_concerns', fieldId: 'college_concerns' }],
    },
    {
      id: 'review', title: 'Review & Submit', subtitle: 'Confirm & submit', timeEstimateMinutes: 1, audience: 'client_and_staff',
      items: [{ kind: 'block', id: 'review_submit', blockId: 'review_submit' }],
    },
  ],
}
