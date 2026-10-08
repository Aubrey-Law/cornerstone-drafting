import {
  getActiveSteps,
  getRequiredSteps,
  getStepIssues,
  getSubmissionErrors,
  type IntakeRow,
} from '@/lib/intake/legacySections'

export interface IntakeParityCase {
  name: string
  data: IntakeRow
}

export const CONTACT_ONLY: IntakeRow = {
  first_name: 'Jane',
  last_name: 'Example',
  email: 'jane@example.com',
  phone: '(617) 555-0100',
}

export const COMPLETE_ESTATE: IntakeRow = {
  ...CONTACT_ONLY,
  address_line1: '1 Main Street', city: 'Boston', state: 'MA', zip: '02108',
  date_of_birth: '1980-01-01', county: 'Suffolk', marital_status: 'single',
  has_children: false, estate_value: 'under_500k', asset_types: ['financial'],
  has_real_property: false, planning_goals: ['avoid_probate'],
  _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Representative' }],
  _fid_poa_client: [{ first_name: 'Alex', last_name: 'Agent' }],
  _fid_hcp_client: [{ first_name: 'Casey', last_name: 'Proxy' }],
  _fid_trustee_client: [{ first_name: 'Taylor', last_name: 'Trustee' }],
}

export const COMPLETE_COLLEGE: IntakeRow = {
  ...CONTACT_ONLY,
  intake_track: 'college_prep',
  street_address: '12 Elm Street', city: 'Newton', state: 'MA', zip: '02458',
  county: 'Middlesex', date_of_birth: '2007-04-02',
  college_school_name: 'Northeastern University', college_school_city: 'Boston',
  college_school_state: 'MA', college_move_in_date: '2026-08-28',
  college_ferpa_release: true, college_ferpa_records: ['grades', 'billing'],
  _additional_contacts: [{ id: '1', first_name: 'Alma', last_name: 'Example', relationship: 'Mother' }],
  _fid_poa_client: [{ first_name: 'Alma', last_name: 'Example', priority: 1 }],
  _fid_hcp_client: [{ first_name: 'Alma', last_name: 'Example', priority: 1 }],
  college_hipaa_recipients: [{ id: 'r1', name: 'Alma Example', relationship: 'Mother' }],
  college_dpoa_effective: 'immediately', college_dpoa_powers: ['banking', 'tuition'],
  college_hipaa_scope: 'all', college_hipaa_expiration: 'none',
  college_living_will_include: 'yes', college_life_support: 'comfort_only',
  college_organ_donation: 'any',
}

export const INTAKE_PARITY_CASES: readonly IntakeParityCase[] = [
  { name: 'estate blank', data: {} },
  { name: 'estate contact only', data: CONTACT_ONLY },
  {
    name: 'estate married with minor child',
    data: {
      ...CONTACT_ONLY,
      marital_status: 'married',
      has_children: true,
      has_minor_children: true,
      _children: [{ first_name: 'Casey', last_name: 'Example', date_of_birth: '2018-01-02' }],
    },
  },
  { name: 'estate legacy value', data: { ...CONTACT_ONLY, estate_value: 'under_1m' } },
  { name: 'estate complete', data: COMPLETE_ESTATE },
  { name: 'college blank', data: { intake_track: 'college_prep' } },
  {
    name: 'college under eighteen',
    data: { ...CONTACT_ONLY, intake_track: 'college_prep', date_of_birth: '2010-01-01' },
  },
  { name: 'college complete', data: COMPLETE_COLLEGE },
]

export interface IntakeParityResult {
  activeIds: string[]
  requiredIds: string[]
  completionById: Record<string, boolean>
  issuesById: Record<string, Array<{ message: string; severity: string; blocksSubmission: boolean }>>
  submissionErrors: Array<{ sectionId: string; message: string }>
}

export function captureLegacyIntakeResult(data: IntakeRow): IntakeParityResult {
  const active = getActiveSteps(data)
  return {
    activeIds: active.map((step) => step.id),
    requiredIds: getRequiredSteps(data).map((step) => step.id),
    completionById: Object.fromEntries(active.map((step) => [step.id, step.isComplete(data)])),
    issuesById: Object.fromEntries(active.map((step) => [
      step.id,
      getStepIssues(step.id, data).map((issue) => ({
        message: issue.message,
        severity: issue.severity,
        blocksSubmission: issue.blocksSubmission === true,
      })),
    ])),
    submissionErrors: getSubmissionErrors(data).map((issue) => ({
      sectionId: issue.sectionId,
      message: issue.message,
    })),
  }
}
