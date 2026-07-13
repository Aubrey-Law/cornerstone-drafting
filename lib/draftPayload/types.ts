import type { DesignSheetChild, RemoteCharity, StaggeredTier } from '@/types/database'
import type { TrustPlanningType } from '@/lib/designSheetDocumentInclusions'
import type { FiduciaryDocumentInclusions } from '@/lib/designSheet/fiduciaryDocumentInclusions'
import type { DraftPayloadAsset } from '@/lib/draftPayload/assets'
import type { DraftPayloadFundingPlan } from '@/lib/draftPayload/fundingPlan'
import type { DraftPayloadHomestead } from '@/lib/draftPayload/homestead'
import type { DraftPayloadExcludedGuardian } from '@/lib/draftPayload/excludedGuardians'
import type { DraftPayloadFiduciaryRoleDetails } from '@/lib/draftPayload/fiduciaryDetails'
import type {
  DraftPayloadHealthcareProvisions,
  DraftPayloadHcpProvisions,
  DraftPayloadHipaaProvisions,
} from '@/lib/draftPayload/healthcare'
import type { DraftPayloadFamilyProvisions } from '@/lib/draftPayload/familyProvisions'
import type { DraftPayloadTrustProvisions } from '@/lib/draftPayload/trustProvisions'

// ── Exported interface ────────────────────────────────────────────────────────

export interface DraftPayload {
  matter: {
    id: string
    matter_number: string | null
    type: 'individual' | 'married_individual' | 'married_joint'
    trust_type: 'revocable_living' | null
    practice_area: string | null
    minor_children: boolean
  }
  client: {
    first_name: string
    last_name: string
    full_name: string
    aka: string | null
    preferred_pronoun: string | null
    dob: string | null
    address: string | null
    city: string | null
    county: string | null
    state: string | null
    zip: string | null
    email: string | null
    phone: string | null
    excluded_guardian: string | null
  }
  spouse: {
    first_name: string
    last_name: string
    full_name: string
    aka: string | null
    preferred_pronoun: string | null
    dob: string | null
  } | null
  children: Array<{
    full_name: string
    dob: string | null
    relationship: DesignSheetChild['relationship'] | null
    parentage?: DesignSheetChild['parentage'] | null
    gender?: DesignSheetChild['gender'] | null
    deceased?: boolean
    minor: boolean
  }>
  family_provisions?: DraftPayloadFamilyProvisions
  trust: {
    name: string
    spouse_name: string | null
    display_name: string
    spouse_display_name: string | null
    date: string
    distribution_ages: number[]
    ma_estate_taxable: boolean
    ma_estate_tax_savings: string | null
    separate_trusts: boolean
    has_ilit: boolean
    ilit_trustee: string | null
  } | null
  trust_provisions: DraftPayloadTrustProvisions
  fiduciaries: {
    pr_primary: string | null
    pr_co_primary: string | null
    pr_successor: string | null
    pr_co_successor: string | null
    pr_second_successor: string | null
    dpoa_primary: string | null
    dpoa_co_agent: string | null
    dpoa_successor: string | null
    hcp_primary: string | null
    hcp_primary_address: string | null
    hcp_primary_relationship: string | null
    hcp_successor: string | null
    hcp_successor_address: string | null
    hcp_successor_relationship: string | null
    trustee_initial: string | null
    trustee_co: string | null
    trustee_successor: string | null
    trustee_co_successor: string | null
    trustee_second_successor: string | null
    trustee_co_second_successor: string | null
    guardian_primary: string | null
    guardian_successor: string | null
    guardian_second_successor: string | null
    temp_guardian_primary: string | null
    temp_guardian_co: string | null
    temp_guardian_successor: string | null
    temp_guardian_second_successor: string | null
    spouse_pr_primary: string | null
    spouse_pr_successor: string | null
    spouse_dpoa_primary: string | null
    spouse_dpoa_successor: string | null
    spouse_hcp_primary: string | null
    spouse_hcp_primary_address: string | null
    spouse_hcp_primary_relationship: string | null
    spouse_hcp_successor: string | null
    spouse_hcp_successor_address: string | null
    spouse_hcp_successor_relationship: string | null
    spouse_trustee_successor: string | null
  }
  documents: {
    include_trust: boolean
    include_pour_over_will: boolean
    include_simple_will: boolean
    include_testamentary_trust_will: boolean
    include_dpoa: boolean
    include_hcp: boolean
    include_hipaa: boolean
    include_ahd: boolean
    include_ppm: boolean
    include_parental_appointment: boolean
    include_temp_delegation: boolean
    include_young_adult_estate_plan?: boolean
    /** Asset-transfer package (design-sheet Transfers & Assignments). */
    include_deed?: boolean
    include_trustees_certificate?: boolean
    include_real_estate_trust?: boolean
    include_certificate_of_trust?: boolean
    include_assignment_of_personal_property?: boolean
    include_funding_instructions?: boolean
    include_funding_recommendation?: boolean
    include_homestead_trustee?: boolean
    include_estate_plan_summary?: boolean
    spouse_docs: boolean
    /** Individual-trust structure; `disclaimer` selects the married-individual disclaimer trust. */
    trust_planning_type: TrustPlanningType
  }
  will_provisions: {
    pr_structure: 'single' | 'spouse_first' | 'co_pr' | null
    trustee_structure: 'single' | 'spouse_first' | 'co_trustees' | null
    cotrustee_decision_standard: 'majority' | 'unanimous' | null
    bond: 'no_bond' | 'required'
    supervision: 'unsupervised' | 'supervised'
    simultaneous_death: 'spouse_survives' | 'testator_survives' | 'omit' | null
    utma_age: 18 | 21
    no_contest_clause: 'omit' | 'include'
    include_disclaimer_article: boolean
    include_self_proving_affidavit: boolean
    tangible_property_distribution: string | null
    tangible_property_named_individual: string | null
    pour_over_alternate_disposition: string | null
    pour_over_alternate_named: string | null
    outright_residuary: string | null
    outright_residuary_named: string | null
    outright_residuary_alternate: string | null
    beneficiary_structure: string | null
    single_beneficiary_name: string | null
    single_beneficiary_remainder: string | null
    age_distribution_schedule: string | null
    trust_protector: boolean
    trust_protector_name: string | null
    pet_care_option: 'omit' | 'direct_bequest' | 'pet_trust'
    pet_care_details: Record<string, unknown>
    specific_bequests: unknown[]
    pr_powers: {
      allow_pay_taxes_debts_expenses: boolean
      allow_manage_digital_assets: boolean
      include_distribution_cash_or_kind: boolean
    }
  }
  dpoa_provisions: {
    coagent_manner: 'independently' | 'jointly' | 'majority'
    self_dealing_reviewer: string | null
    self_dealing_reviewer_alt: string | null
    include_section_l: boolean
    include_entity_powers: boolean
    include_advanced_trust_gifting: boolean
    include_extended_personal_care: boolean
    agent_compensation: 'prevailing_professional' | 'reasonable' | 'none' | null
    coagent_serving: 'jointly' | 'separately' | 'silent' | null
    allow_gifts: boolean
    trust_powers: {
      agent_may_create_trusts: boolean
      agent_may_create_trusts_for_dependents: boolean
      allow_agent_as_trustee: boolean
      agent_may_create_medicaid_trusts: boolean
      agent_may_modify_sole_settlor_trusts: boolean
      agent_may_modify_joint_trusts: boolean
    }
    special_powers: {
      allow_delegation: boolean
      prohibit_arbitration: boolean
      power_529_plans: boolean
      allow_medical_information_access: boolean
      power_digital_assets: boolean
      allow_self_designation_beneficiary: boolean
    }
    basic_powers: Record<string, boolean>
    all_basic_powers: boolean
    additional_powers: string | null
    specific_businesses: string | null
    additional_limitations: string | null
  }
  hcp_provisions: DraftPayloadHcpProvisions
  hipaa_provisions: DraftPayloadHipaaProvisions
  healthcare_provisions?: DraftPayloadHealthcareProvisions
  fiduciary_display?: FiduciaryDocumentInclusions
  fiduciary_details?: DraftPayloadFiduciaryRoleDetails
  excluded_guardians?: DraftPayloadExcludedGuardian[]
  assets?: DraftPayloadAsset[]
  funding_plan?: DraftPayloadFundingPlan
  homestead?: DraftPayloadHomestead
  goals_notes?: string | null
  concerns?: string | null
  execution: {
    signing_month: string | null
    signing_year: string | null
    signing_county: string | null
    notary_commission_expiration: string | null
  }
  design_sheet_id: string | null
  special_provisions: string | null
  ancillary_docs: string[]
  notes: string | null
}

// ── Row shapes returned from Supabase ─────────────────────────────────────────

export interface MatterRow {
  id: string
  client_intake_id: string
  matter_number: string | null
  relationship_status: 'lead' | 'hired' | 'lost'
  status: string | null
  stage: string | null
}

export interface MatterDetailsRow {
  id: string
  client_id: string
  practice_area: string | null
  ep_trust_type: string | null
  ep_ancillary_docs: unknown
  ep_special_provisions: string | null
  ep_ma_estate_taxable: boolean | null
  ep_ma_estate_tax_savings: number | null
  ep_separate_trusts: boolean | null
  ep_has_ilit: boolean | null
  ep_ilit_trustee: string | null
  internal_notes: string | null
}

export interface ClientIntakeRow {
  id: string
  matter_id: string | null
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  full_name: string | null
  preferred_pronoun: string | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  city: string | null
  county: string | null
  state: string | null
  zip: string | null
  marital_status: string | null
  has_minor_children: boolean | null
  practice_area: string | null
}

export interface ContactRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  preferred_pronoun: string | null
  relationship_type: string | null
  relationship_label: string | null
  address_line1: string | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  contact_roles: ContactRoleRow[]
}

export interface ContactRoleRow {
  id: string
  contact_id: string
  client_intake_id: string
  role: string
  for_party: string
  priority: number
  is_coagent: boolean
}

export interface DesignSheetRow {
  id: string
  client_intake_id?: string | null
  status: string | null
  client_name?: string | null
  client_dob?: string | null
  client_phone?: string | null
  client_email?: string | null
  client_pronouns?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  marital_status?: string | null
  spouse_name?: string | null
  spouse_dob?: string | null
  spouse_phone?: string | null
  spouse_email?: string | null
  spouse_pronouns?: string | null
  plan_type?: string | null
  is_joint?: boolean | null
  trust_name?: string | null
  spouse_trust_name?: string | null
  trust_date?: string | null
  restatement?: boolean | null
  residual_beneficiary?: string | null
  distribution_method?: string | null
  distribution_age?: number | null
  staggered_distributions?: StaggeredTier[] | null
  remote_beneficiary?: string | null
  remote_beneficiary_individuals?: string[] | null
  remote_beneficiary_charities?: RemoteCharity[] | null
  provision_substance_abuse?: string | null
  provision_married_beneficiary?: string | null
  client_aka?: string | null
  spouse_aka?: string | null
  county?: string | null
  trustee_primary?: string | null
  trustee_co?: string | null
  trustee_alt1?: string | null
  trustee_alt1_co?: string | null
  trustee_alt2?: string | null
  executor_primary?: string | null
  executor_co?: string | null
  executor_alt1?: string | null
  executor_alt1_co?: string | null
  poa_primary?: string | null
  poa_co?: string | null
  poa_alt1?: string | null
  hcp_primary?: string | null
  hcp_co?: string | null
  hcp_alt1?: string | null
  hcp_alt1_co?: string | null
  guardian_primary?: string | null
  guardian_co?: string | null
  guardian_alt1?: string | null
  guardian_alt1_co?: string | null
  excluded_guardian_flag?: boolean | null
  excluded_guardian_name?: string | null
  children?: DesignSheetChild[] | null
  include_child_gender_markers?: string | null
  include_afterborn_children?: string | null
  include_expectant_children?: string | null
  omissions_intentional?: string | null
  include_general_disinheritance?: string | null
  disinherited_children?: string[] | null
  disinherit_issue?: string | null
  additional_disinheritance_language?: string | null
  disinheritances?: { name: string; relationship: string; reason: string }[] | null
  // Will-common selections
  pr_structure?: string | null
  bond?: string | null
  supervision?: string | null
  simultaneous_death?: string | null
  utma_age?: number | null
  no_contest_clause?: string | null
  include_disclaimer_article?: boolean | null
  include_self_proving_affidavit?: boolean | null
  tangible_property_distribution?: string | null
  tangible_property_named_individual?: string | null
  // Pet care + bequests
  pet_care_option?: string | null
  pet_care_details?: Record<string, unknown> | null
  specific_bequests?: unknown[] | null
  // DPOA / HCP / HIPAA
  dpoa_coagent_manner?: string | null
  dpoa_self_dealing_reviewer?: string | null
  dpoa_self_dealing_reviewer_alt?: string | null
  dpoa_include_section_l?: string | null
  hcp_anatomical_gift?: string | null
  hcp_anatomical_specified?: string | null
  hipaa_psychotherapy_notes?: string | null
  // Pour-Over
  pour_over_alternate_disposition?: string | null
  pour_over_alternate_named?: string | null
  // Outright
  outright_residuary?: string | null
  outright_residuary_named?: string | null
  outright_residuary_alternate?: string | null
  // Testamentary trust
  trustee_structure?: string | null
  cotrustee_decision_standard?: string | null
  beneficiary_structure?: string | null
  single_beneficiary_name?: string | null
  single_beneficiary_remainder?: string | null
  age_distribution_schedule?: string | null
  trust_protector?: boolean | null
  trust_protector_name?: string | null
  // Execution mechanics
  signing_month?: string | null
  signing_year?: string | null
  signing_county?: string | null
  notary_commission_expiration?: string | null
  trustee_slots?: FiduciarySlotRow[] | null
  executor_slots?: FiduciarySlotRow[] | null
  poa_slots?: FiduciarySlotRow[] | null
  hcp_slots?: FiduciarySlotRow[] | null
  guardian_slots?: FiduciarySlotRow[] | null
  temporary_guardian_slots?: FiduciarySlotRow[] | null
  spouse_trustee_slots?: FiduciarySlotRow[] | null
  spouse_executor_slots?: FiduciarySlotRow[] | null
  spouse_poa_slots?: FiduciarySlotRow[] | null
  spouse_hcp_slots?: FiduciarySlotRow[] | null
  assets?: import('@/types/database').AssetItem[] | null
  goals_notes?: string | null
  concerns?: string | null
  decisions?: Record<string, unknown> | null
}

export interface FiduciarySlotRow {
  id: string
  contact_id: string | null
  is_co: boolean
  order: number
}
