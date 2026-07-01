export type NodeEstatePackageName =
  | 'core-estate'
  | 'design-summary'
  | 'estate-plan-summary'
  | 'incapacity-documents'
  | 'indv-disclaimer-trust'
  | 'joint-trust'
  | 'joint-trust-simplified'
  | 'parental-guardian-appointment'
  | 'personal-property-memorandum'
  | 'pourover-will'
  | 'simple-will'
  | 'spouse-incapacity-documents'
  | 'spouse-pourover-will'
  | 'spouse-testamentary-trust-will'
  | 'testamentary-trust-will'
  | 'trust-individual-single'
  | 'young-adult-estate-plan'

export interface NodeEstatePackageDocument {
  id: string
  title: string
  template: string
  output: string
}

export interface NodeEstatePackageConfig {
  name: NodeEstatePackageName
  description?: string
  required_fields: string[]
  documents: NodeEstatePackageDocument[]
}

export interface NodeEstateGeneratedFile {
  /** Slug output name from the package config, e.g. `01-durable-power-of-attorney.docx`. */
  name: string
  buffer: Buffer
  /** Friendly document title, e.g. "Durable Power of Attorney". */
  title: string
  /** Full name(s) of the person this document belongs to; null when unknown. */
  owner: string | null
  /** Leftover `{{ }}` / `{% %}` / `[ALL-CAPS]` markers in this document's render. */
  unresolvedMarkers?: string[]
  /** `[[ MISSING: path ]]` field holes in this document's render. */
  missingFields?: string[]
}

export type NodeEstateGeneratorResult =
  | {
      ok: true
      files: NodeEstateGeneratedFile[]
      missing: string[]
      warnings: string[]
      packageName: NodeEstatePackageName
      packageNames: NodeEstatePackageName[]
      clientSlug: string
    }
  | {
      ok: false
      error: string
      status: number
      missing?: string[]
      warnings?: string[]
    }

export interface NodeEstateStateRules {
  state: string
  requires_self_proving_affidavit?: boolean
  witness_count?: number
  notary_required_for_self_proving_affidavit?: boolean
  notes?: string
  [key: string]: unknown
}

export type NodeEstateData = Record<string, unknown>

export type NodeEstateContext = NodeEstateData & {
  state: { code: string } & NodeEstateStateRules
  has_spouse: boolean
  has_children: boolean
  has_minor_children: boolean
  has_blended_family: boolean
  has_co_poa: boolean
  has_solo_poa: boolean
  co_poa_joint: boolean
  co_poa_majority: boolean
  co_poa_separate: boolean
  aif_has_spouse: boolean
  has_dpoa_self_dealing_reviewer: boolean
  has_dpoa_self_dealing_reviewer_alt: boolean
  hcp_anatomical_all: boolean
  hcp_anatomical_specified: boolean
  hcp_anatomical_none: boolean
  hipaa_psychotherapy_authorized: boolean
  uses_revocable_trust: boolean
  requires_guardian_clause: boolean
  has_specific_gifts: boolean
  has_charitable_gifts: boolean
  has_tangible_personal_property: boolean
  has_pet_care: boolean
  has_simultaneous_death: boolean
  has_excluded_guardians: boolean
  owns_real_property: boolean
  tax_sensitive_estate: boolean
  state_requires_self_proving_affidavit: boolean
  signing_scheduled: boolean
  client: Record<string, unknown>
  will: Record<string, unknown>
  trust: Record<string, unknown>
  outright_will: Record<string, unknown>
  dpoa: Record<string, unknown>
  healthcare: Record<string, unknown>
  hipaa: Record<string, unknown>
  execution: Record<string, unknown>
  young_adult?: Record<string, unknown>
}
