import type { DesignSheet, DesignSheetUpdate } from '@/types/database'
import { formatPhoneFieldsDeep } from '@/lib/phone'

const SYSTEM_COLUMNS = new Set(['id', 'matter_id', 'client_intake_id', 'created_at', 'updated_at'])
const RETIRED_DESIGN_SHEET_KEYS = new Set(['inheritance_structure'])

// jsonb fields that must always inflate to an array. A few legacy rows have a
// `{}` default stored instead of `[]`, which would crash `.some`/`.map` callers
// (e.g. design-sheet readiness). Coerce any non-array value to an empty array.
const ARRAY_DESIGN_SHEET_FIELDS = new Set([
  'assets',
  'children',
  'specific_bequests',
  'disinheritances',
  'disinherited_children',
  'additional_beneficiaries',
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'temporary_guardian_slots',
  'spouse_trustee_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
  'remote_beneficiary_individuals',
  'remote_beneficiary_charities',
  'residual_beneficiary_individuals',
  'staggered_distributions',
])

// Columns added by 20260715000000_lite_design_sheets_intake_columns.sql — intake seed
// must write here (not only into decisions) so isDesignSheetUnseeded and resync work.
const INTAKE_MIRROR_DESIGN_SHEET_COLUMNS = [
  'client_name',
  'client_dob',
  'client_phone',
  'client_email',
  'client_citizenship',
  'client_domicile',
  'street',
  'city',
  'state',
  'zip',
  'county',
  'marital_status',
  'spouse_name',
  'spouse_dob',
  'spouse_phone',
  'spouse_email',
  'spouse_citizenship',
  'marriage_date',
  'trustee_primary',
  'trustee_alt1',
  'executor_primary',
  'executor_alt1',
  'poa_primary',
  'poa_alt1',
  'hcp_primary',
  'hcp_alt1',
  'guardian_primary',
  'guardian_alt1',
  'children',
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
  'overrides',
] as const

const WRITABLE_DESIGN_SHEET_COLUMNS = new Set([
  ...INTAKE_MIRROR_DESIGN_SHEET_COLUMNS,
  'version',
  'status',
  'plan_type',
  'real_property_transfer',
  'trust_name',
  'trust_type',
  'client2_trust_name',
  'original_trust_date',
  'restatement',
  'trust_protector',
  'marital_trust_type',
  'marital_trust_remarriage',
  'include_qdot',
  'family_trust_remarriage',
  'common_trust',
  'residuary_beneficiary',
  'residuary_distribution',
  'withdrawal_right',
  'poa_client_co_authority',
  'poa_spouse_co_authority',
  'marital_status_clause',
  'doc_date',
  'ordinal_doc_date',
  'notary_commission',
  'flags',
  'drafting_notes',
  'lawmatics_prospect_id',
  'lawmatics_matter_id',
  'lawmatics_synced_at',
  'created_by',
  'updated_by',
  'decisions',
  'fiduciary_slot_states',
  'goals_notes',
  'concerns',
  'assets',
  'is_joint',
  'spouse_trust_name',
  'include_child_gender_markers',
  'omissions_intentional',
  'disinherited_children',
  'disinherit_issue',
  'additional_disinheritance_language',
  'include_additional_beneficiaries',
  'disinheritances',
  'stagger_age_1',
  'stagger_pct_1',
  'stagger_age_2',
  'stagger_pct_2',
  'stagger_age_3',
  'tangible_property_distribution',
  'tangible_property_named_individual',
  'include_common_disaster',
  'include_guardians_allowance',
  'beneficiary_as_cotrustee',
  'beneficiary_as_sole_trustee',
  'remote_beneficiary',
  'provision_lifestyle_disability',
  'provision_substance_abuse',
  'provision_married_beneficiary',
  // Universal additions
  'client_aka',
  'client_pronouns',
  'spouse_pronouns',
  'former_spouse_name',
  'deceased_spouse_name',
  'signing_date',
  'signing_month',
  'signing_year',
  'signing_county',
  'notary_commission_expiration',
  // DPOA
  'dpoa_coagent_manner',
  'dpoa_include_self_dealing',
  'dpoa_self_dealing_reviewer',
  'dpoa_self_dealing_reviewer_alt',
  'dpoa_include_section_l',
  // HCP
  'hcp_anatomical_gift',
  'hcp_anatomical_specified',
  // HIPAA
  'hipaa_psychotherapy_notes',
  // Will common
  'specific_bequests',
  'pet_care_option',
  'pet_care_details',
  'pr_structure',
  'bond',
  'supervision',
  'simultaneous_death',
  'utma_age',
  'no_contest_clause',
  'include_disclaimer_article',
  'include_self_proving_affidavit',
  'excluded_guardian_flag',
  'excluded_guardian_name',
  // Pour-Over
  'trust_date',
  'pour_over_alternate_disposition',
  'pour_over_alternate_named',
  // Outright
  'outright_residuary',
  'outright_residuary_named',
  'outright_residuary_alternate',
  // Testamentary trust
  'trustee_structure',
  'cotrustee_decision_standard',
  'beneficiary_structure',
  'single_beneficiary_name',
  'single_beneficiary_remainder',
  'age_distribution_schedule',
  'trust_protector_name',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeColumnValue(key: string, value: unknown) {
  if (key === 'trust_protector' && typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  if (key === 'fiduciary_slot_states' && value == null) {
    return {}
  }
  return value
}

function normalizeTrustProtector(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return value ?? null
  const normalized = value.toLowerCase()
  if (normalized === 'yes' || normalized === 'true') return true
  if (normalized === 'no' || normalized === 'false') return false
  return value
}

export function buildDesignSheetPersistencePayload(data: DesignSheetUpdate) {
  const input = formatPhoneFieldsDeep(data) as Record<string, unknown>
  const payload: Record<string, unknown> = {}
  const decisions: Record<string, unknown> = isRecord(input.decisions) ? { ...input.decisions } : {}

  for (const [key, value] of Object.entries(input)) {
    if (SYSTEM_COLUMNS.has(key) || key === 'decisions') continue
    if (RETIRED_DESIGN_SHEET_KEYS.has(key)) continue

    if (WRITABLE_DESIGN_SHEET_COLUMNS.has(key)) {
      payload[key] = normalizeColumnValue(key, value)
    } else {
      decisions[key] = value
    }
  }

  payload.decisions = decisions
  return payload
}

export function inflateDesignSheetRow(row: Record<string, unknown> | null): DesignSheet | null {
  if (!row) return null

  const decisions = isRecord(row.decisions) ? row.decisions : {}
  const sheet = { ...row, decisions } as Record<string, unknown>

  for (const [key, value] of Object.entries(decisions)) {
    if (SYSTEM_COLUMNS.has(key) || key === 'decisions') continue
    if (RETIRED_DESIGN_SHEET_KEYS.has(key)) continue

    if (WRITABLE_DESIGN_SHEET_COLUMNS.has(key)) {
      sheet[key] ??= value
    } else {
      sheet[key] = value
    }
  }

  sheet.trust_protector = normalizeTrustProtector(sheet.trust_protector)

  // Normalise array-typed jsonb fields so a malformed `{}` never reaches
  // consumers that call array methods (e.g. design-sheet readiness).
  for (const key of ARRAY_DESIGN_SHEET_FIELDS) {
    if (sheet[key] != null && !Array.isArray(sheet[key])) {
      sheet[key] = []
    }
  }

  return sheet as unknown as DesignSheet
}
