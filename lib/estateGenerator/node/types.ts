import type { EstateClauseManifestEntry } from '@/lib/estateClauses/types'
import type { EstateDocumentType } from '@/lib/estateClauses/types'

export type NodeEstatePackageName =
  | 'core-estate'
  | 'design-summary'
  | 'estate-plan-summary'
  | 'incapacity-documents'
  | 'indv-disclaimer-trust'
  | 'joint-trust'
  | 'joint-trust-simplified'
  | 'parental-guardian-appointment'
  | 'temporary-delegation-parental-powers'
  | 'personal-property-memorandum'
  | 'pourover-will'
  | 'simple-will'
  | 'spouse-incapacity-documents'
  | 'spouse-pourover-will'
  | 'spouse-testamentary-trust-will'
  | 'testamentary-trust-will'
  | 'trust-individual-single'
  | 'certificate-of-trust'
  | 'assignment-of-personal-property'
  | 'funding-instructions'
  | 'trust-funding-plan'
  | 'homestead-trustee'
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
  /** Frozen clause source and exact published revisions rendered into this file. */
  clauseSource: 'database' | 'file'
  clauseManifest: EstateClauseManifestEntry[]
  estateDocumentTypes: EstateDocumentType[]
  templateSha256: string
  /** Leftover `{{ }}` / `{% %}` / `[ALL-CAPS]` markers in this document's render. */
  unresolvedMarkers?: string[]
  /** `[[ MISSING: path ]]` field holes in this document's render. */
  missingFields?: string[]
  /** Published-template provenance; null means the repository-bundled master. */
  templateId?: string
  templateVersionId?: string | null
  templateSource?: 'bundled' | 'published'
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
  minor_children: Array<Record<string, unknown>>
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
  hcp_anatomical_defer: boolean
  hcp_client_advance_prolong_life: boolean
  hcp_client_advance_dnr: boolean
  hcp_client_advance_do_not_prolong: boolean
  hcp_spouse_advance_prolong_life: boolean
  hcp_spouse_advance_dnr: boolean
  hcp_spouse_advance_do_not_prolong: boolean
  hipaa_psychotherapy_authorized: boolean
  hipaa_include_poa: boolean
  hipaa_include_trustees: boolean
  hipaa_list_fiduciaries_by_name: boolean
  hipaa_list_fiduciaries_general: boolean
  uses_revocable_trust: boolean
  includes_pour_over_will: boolean
  includes_simple_will: boolean
  includes_dpoa: boolean
  includes_hcp: boolean
  includes_hipaa: boolean
  distributes_to_descendants: boolean
  dpoa_gifting_authorized: boolean
  requires_guardian_clause: boolean
  has_specific_gifts: boolean
  has_charitable_gifts: boolean
  has_tangible_personal_property: boolean
  has_pet_care: boolean
  has_simultaneous_death: boolean
  has_excluded_guardians: boolean
  has_disinherited: boolean
  include_child_gender_markers: boolean
  include_afterborn_children: boolean
  include_expectant_children: boolean
  omissions_intentional: boolean
  include_general_disinheritance: boolean
  disinherit_issue: boolean
  owns_real_property: boolean
  has_assets: boolean
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
