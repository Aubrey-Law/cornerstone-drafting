// Shared types and helpers for admin-authored intake form
// Kept separate from app/actions/adminIntake.ts because 'use server' files
// may only export async functions — non-async exports cause build errors.

export interface AdminIntakeChild {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  date_of_birth: string
  preferred_pronoun: string
}

export interface AdminIntakeFormData {
  // Personal
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  date_of_birth: string
  is_us_citizen: boolean | null
  citizenship_status: import('@/lib/sharedFields').CitizenshipStatus
  preferred_pronoun: string
  phone: string
  email: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
  county: string

  // Family
  marital_status: string
  has_children: boolean
  has_minor_children: boolean
  children: AdminIntakeChild[]
  family_notes: string

  // Spouse
  spouse_first_name: string
  spouse_middle_name: string
  spouse_last_name: string
  spouse_date_of_birth: string
  spouse_is_us_citizen: boolean | null
  spouse_citizenship_status: import('@/lib/sharedFields').CitizenshipStatus
  spouse_preferred_pronoun: string
  spouse_phone: string
  spouse_email: string
  date_of_marriage: string

  // Estate / Assets
  estate_value: string
  has_real_property: boolean
  real_property_address: string
  real_property_value: string
  has_retirement: boolean
  retirement_value: string
  has_life_insurance: boolean
  life_insurance_value: string
  has_business: boolean
  business_description: string
  has_investments: boolean

  // Goals (EP)
  planning_objectives: string
  has_existing_plan: boolean
  has_will: boolean
  has_trust: boolean
  has_poa: boolean
  has_hcp: boolean
  special_circumstances: string[]

  // Fiduciaries (EP) — each name is paired with the pronouns the documents
  // should use for that person.
  trustee_primary: string
  trustee_primary_pronouns: string
  trustee_alternate: string
  trustee_alternate_pronouns: string
  executor_primary: string
  executor_primary_pronouns: string
  executor_alternate: string
  executor_alternate_pronouns: string
  poa_primary: string
  poa_primary_pronouns: string
  poa_alternate: string
  poa_alternate_pronouns: string
  hcp_primary: string
  hcp_primary_pronouns: string
  hcp_alternate: string
  hcp_alternate_pronouns: string
  guardian_primary: string
  guardian_primary_pronouns: string
  guardian_alternate: string
  guardian_alternate_pronouns: string

  // Probate
  pb_decedent_name: string
  pb_date_of_death: string
  pb_domicile: string
  pb_estate_value: string
  pb_known_assets: string
  pb_known_debts: string
  pb_petitioner_relationship: string
  pb_goals_timeline: string

  // Internal notes
  special_notes: string
}

export function emptyAdminIntakeFormData(): AdminIntakeFormData {
  return {
    first_name: '', middle_name: '', last_name: '', suffix: '',
    date_of_birth: '', is_us_citizen: null, citizenship_status: 'unknown', preferred_pronoun: '', phone: '', email: '',
    address_line1: '', address_line2: '', city: '', state: 'MA', zip: '', county: '',
    marital_status: '', has_children: false, has_minor_children: false,
    children: [], family_notes: '',
    spouse_first_name: '', spouse_middle_name: '', spouse_last_name: '', spouse_date_of_birth: '',
    spouse_is_us_citizen: null, spouse_citizenship_status: 'unknown', spouse_preferred_pronoun: '',
    spouse_phone: '', spouse_email: '', date_of_marriage: '',
    estate_value: '', has_real_property: false, real_property_address: '',
    real_property_value: '', has_retirement: false, retirement_value: '',
    has_life_insurance: false, life_insurance_value: '', has_business: false,
    business_description: '', has_investments: false,
    planning_objectives: '', has_existing_plan: false,
    has_will: false, has_trust: false, has_poa: false, has_hcp: false,
    special_circumstances: [],
    trustee_primary: '', trustee_alternate: '', executor_primary: '',
    executor_alternate: '', poa_primary: '', poa_alternate: '',
    hcp_primary: '', hcp_alternate: '', guardian_primary: '', guardian_alternate: '',
    trustee_primary_pronouns: '', trustee_alternate_pronouns: '',
    executor_primary_pronouns: '', executor_alternate_pronouns: '',
    poa_primary_pronouns: '', poa_alternate_pronouns: '',
    hcp_primary_pronouns: '', hcp_alternate_pronouns: '',
    guardian_primary_pronouns: '', guardian_alternate_pronouns: '',
    pb_decedent_name: '', pb_date_of_death: '', pb_domicile: '',
    pb_estate_value: '', pb_known_assets: '', pb_known_debts: '',
    pb_petitioner_relationship: '', pb_goals_timeline: '',
    special_notes: '',
  }
}
