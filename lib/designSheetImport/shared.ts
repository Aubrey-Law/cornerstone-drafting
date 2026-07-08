import type { AssetItem, DesignSheetChild, DesignSheetUpdate } from '@/types/database'

export const MIN_DESIGN_SHEET_IMPORT_TEXT_LENGTH = 20
export const MAX_DESIGN_SHEET_IMPORT_TEXT_LENGTH = 60_000
export const MAX_DESIGN_SHEET_DOCX_BYTES = 10 * 1024 * 1024
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type DesignSheetImportField = keyof DesignSheetUpdate | 'drafting_notes'
export type DesignSheetImportProposal = Partial<Record<DesignSheetImportField, unknown>>

export interface DesignSheetImportPreviewRow {
  field: DesignSheetImportField
  label: string
  section: string
  currentValue: unknown
  proposedValue: unknown
  currentDisplay: string
  proposedDisplay: string
  selected: boolean
  replacement: boolean
}

export interface DesignSheetImportResult {
  proposed: DesignSheetImportProposal
  preview: DesignSheetImportPreviewRow[]
}

type FieldKind = 'string' | 'boolean' | 'number' | 'children' | 'assets' | 'json'
type FieldMeta = { section: string; label: string; kind: FieldKind }

export const DESIGN_SHEET_IMPORT_FIELDS = {
  client_name: { section: 'Personal', label: 'Client name', kind: 'string' },
  client_dob: { section: 'Personal', label: 'Client date of birth', kind: 'string' },
  client_phone: { section: 'Personal', label: 'Client phone', kind: 'string' },
  client_email: { section: 'Personal', label: 'Client email', kind: 'string' },
  client_citizenship: { section: 'Personal', label: 'Client citizenship', kind: 'string' },
  client_domicile: { section: 'Personal', label: 'Client domicile', kind: 'string' },
  client_aka: { section: 'Personal', label: 'Client AKA', kind: 'string' },
  client_pronouns: { section: 'Personal', label: 'Client pronouns', kind: 'string' },
  street: { section: 'Personal', label: 'Street', kind: 'string' },
  city: { section: 'Personal', label: 'City', kind: 'string' },
  state: { section: 'Personal', label: 'State', kind: 'string' },
  zip: { section: 'Personal', label: 'ZIP', kind: 'string' },
  county: { section: 'Personal', label: 'County', kind: 'string' },
  marital_status: { section: 'Personal', label: 'Marital status', kind: 'string' },

  spouse_name: { section: 'Family', label: 'Spouse name', kind: 'string' },
  spouse_dob: { section: 'Family', label: 'Spouse date of birth', kind: 'string' },
  spouse_phone: { section: 'Family', label: 'Spouse phone', kind: 'string' },
  spouse_email: { section: 'Family', label: 'Spouse email', kind: 'string' },
  spouse_citizenship: { section: 'Family', label: 'Spouse citizenship', kind: 'string' },
  spouse_aka: { section: 'Family', label: 'Spouse AKA', kind: 'string' },
  spouse_pronouns: { section: 'Family', label: 'Spouse pronouns', kind: 'string' },
  marriage_date: { section: 'Family', label: 'Marriage date', kind: 'string' },
  former_spouse_name: { section: 'Family', label: 'Former spouse name', kind: 'string' },
  deceased_spouse_name: { section: 'Family', label: 'Deceased spouse name', kind: 'string' },
  children: { section: 'Family', label: 'Children', kind: 'children' },

  trustee_primary: { section: 'Trust', label: 'Trustee primary', kind: 'string' },
  trustee_co: { section: 'Trust', label: 'Trustee co-agent', kind: 'string' },
  trustee_alt1: { section: 'Trust', label: 'Trustee alternate', kind: 'string' },
  trustee_alt1_co: { section: 'Trust', label: 'Trustee alternate co-agent', kind: 'string' },
  trustee_alt2: { section: 'Trust', label: 'Trustee second alternate', kind: 'string' },
  executor_primary: { section: 'Will', label: 'Personal representative primary', kind: 'string' },
  executor_co: { section: 'Will', label: 'Personal representative co-agent', kind: 'string' },
  executor_alt1: { section: 'Will', label: 'Personal representative alternate', kind: 'string' },
  executor_alt1_co: { section: 'Will', label: 'Personal representative alternate co-agent', kind: 'string' },
  executor_same_as_trustee: { section: 'Will', label: 'PR same as trustee', kind: 'boolean' },
  spouse_executor_same_as_trustee: { section: 'Will', label: 'Spouse PR same as trustee', kind: 'boolean' },
  poa_primary: { section: 'Durable Power of Attorney', label: 'DPOA primary', kind: 'string' },
  poa_co: { section: 'Durable Power of Attorney', label: 'DPOA co-agent', kind: 'string' },
  poa_alt1: { section: 'Durable Power of Attorney', label: 'DPOA alternate', kind: 'string' },
  poa_same_as_trustee: { section: 'Durable Power of Attorney', label: 'DPOA same as trustee', kind: 'boolean' },
  spouse_poa_same_as_trustee: { section: 'Durable Power of Attorney', label: 'Spouse DPOA same as trustee', kind: 'boolean' },
  hcp_primary: { section: 'Health Care Documents', label: 'Health care proxy primary', kind: 'string' },
  hcp_co: { section: 'Health Care Documents', label: 'Health care proxy co-agent', kind: 'string' },
  hcp_alt1: { section: 'Health Care Documents', label: 'Health care proxy alternate', kind: 'string' },
  hcp_alt1_co: { section: 'Health Care Documents', label: 'Health care proxy alternate co-agent', kind: 'string' },
  guardian_primary: { section: 'Will', label: 'Guardian primary', kind: 'string' },
  guardian_co: { section: 'Will', label: 'Guardian co-guardian', kind: 'string' },
  guardian_alt1: { section: 'Will', label: 'Guardian alternate', kind: 'string' },
  guardian_alt1_co: { section: 'Will', label: 'Guardian alternate co-guardian', kind: 'string' },

  plan_type: { section: 'Plan Design', label: 'Plan type', kind: 'string' },
  is_joint: { section: 'Plan Design', label: 'Joint plan', kind: 'boolean' },
  trust_name: { section: 'Trust', label: 'Trust name', kind: 'string' },
  spouse_trust_name: { section: 'Trust', label: 'Spouse trust name', kind: 'string' },
  restatement: { section: 'Trust', label: 'Restatement', kind: 'boolean' },
  trust_protector: { section: 'Trust', label: 'Trust protector', kind: 'boolean' },
  distribution_method: { section: 'Trust', label: 'Distribution method', kind: 'string' },
  distribution_age: { section: 'Trust', label: 'Distribution age', kind: 'number' },
  stagger_age_1: { section: 'Trust', label: 'First stagger age', kind: 'number' },
  stagger_pct_1: { section: 'Trust', label: 'First stagger percentage', kind: 'number' },
  stagger_age_2: { section: 'Trust', label: 'Second stagger age', kind: 'number' },
  stagger_pct_2: { section: 'Trust', label: 'Second stagger percentage', kind: 'number' },
  stagger_age_3: { section: 'Trust', label: 'Final stagger age', kind: 'number' },

  include_child_gender_markers: { section: 'Family', label: 'Include child gender markers', kind: 'string' },
  include_afterborn_children: { section: 'Family', label: 'Afterborn children', kind: 'string' },
  include_expectant_children: { section: 'Family', label: 'Posthumous children', kind: 'string' },
  omissions_intentional: { section: 'Family', label: 'Omissions intentional', kind: 'string' },
  include_general_disinheritance: { section: 'Family', label: 'General disinheritance', kind: 'string' },
  disinherited_children: { section: 'Family', label: 'Disinherited children', kind: 'json' },
  disinherit_issue: { section: 'Family', label: 'Disinherit issue', kind: 'string' },
  additional_disinheritance_language: { section: 'Family', label: 'Additional disinheritance language', kind: 'string' },
  tangible_property_distribution: { section: 'Trust', label: 'Tangible property distribution', kind: 'string' },
  tangible_property_named_individual: { section: 'Trust', label: 'Tangible property named individual', kind: 'string' },
  include_common_disaster: { section: 'Trust', label: 'Common disaster clause', kind: 'string' },
  include_guardians_allowance: { section: 'Trust', label: 'Guardian allowance', kind: 'string' },
  beneficiary_as_cotrustee: { section: 'Trust', label: 'Beneficiary as co-trustee', kind: 'string' },
  beneficiary_as_sole_trustee: { section: 'Trust', label: 'Beneficiary as sole trustee', kind: 'string' },
  remote_beneficiary: { section: 'Trust', label: 'Remote beneficiary', kind: 'string' },
  provision_lifestyle_disability: { section: 'Trust', label: 'Lifestyle/disability provision', kind: 'string' },
  provision_substance_abuse: { section: 'Trust', label: 'Substance abuse provision', kind: 'string' },
  provision_married_beneficiary: { section: 'Trust', label: 'Married beneficiary provision', kind: 'string' },
  specific_bequests: { section: 'Will', label: 'Specific bequests', kind: 'json' },
  pet_care_option: { section: 'Will', label: 'Pet care option', kind: 'string' },
  pet_care_details: { section: 'Will', label: 'Pet care details', kind: 'json' },
  pr_structure: { section: 'Will', label: 'PR structure', kind: 'string' },
  bond: { section: 'Will', label: 'Bond', kind: 'string' },
  supervision: { section: 'Will', label: 'Supervision', kind: 'string' },
  simultaneous_death: { section: 'Will', label: 'Simultaneous death', kind: 'string' },
  utma_age: { section: 'Will', label: 'UTMA age', kind: 'number' },
  no_contest_clause: { section: 'Will', label: 'No-contest clause', kind: 'string' },
  include_disclaimer_article: { section: 'Will', label: 'Disclaimer article', kind: 'boolean' },
  include_self_proving_affidavit: { section: 'Will', label: 'Self-proving affidavit', kind: 'boolean' },
  excluded_guardian_flag: { section: 'Will', label: 'Excluded guardian', kind: 'boolean' },
  excluded_guardian_name: { section: 'Will', label: 'Excluded guardian name', kind: 'string' },
  trust_date: { section: 'Will', label: 'Trust date', kind: 'string' },
  pour_over_alternate_disposition: { section: 'Will', label: 'Pour-over alternate disposition', kind: 'string' },
  pour_over_alternate_named: { section: 'Will', label: 'Pour-over alternate named beneficiary', kind: 'string' },
  outright_residuary: { section: 'Will', label: 'Outright residuary', kind: 'string' },
  outright_residuary_named: { section: 'Will', label: 'Outright residuary named beneficiary', kind: 'string' },
  outright_residuary_alternate: { section: 'Will', label: 'Outright residuary alternate', kind: 'string' },
  trustee_structure: { section: 'Will', label: 'Testamentary trustee structure', kind: 'string' },
  cotrustee_decision_standard: { section: 'Will', label: 'Co-trustee decision standard', kind: 'string' },
  beneficiary_structure: { section: 'Will', label: 'Beneficiary structure', kind: 'string' },
  single_beneficiary_name: { section: 'Will', label: 'Single beneficiary name', kind: 'string' },
  single_beneficiary_remainder: { section: 'Will', label: 'Single beneficiary remainder', kind: 'string' },
  age_distribution_schedule: { section: 'Will', label: 'Age distribution schedule', kind: 'string' },
  trust_protector_name: { section: 'Trust', label: 'Trust protector name', kind: 'string' },
  disinheritances: { section: 'Family', label: 'Disinherited heirs', kind: 'json' },

  goals_notes: { section: 'Goals & Notes', label: 'Goals notes', kind: 'string' },
  concerns: { section: 'Goals & Notes', label: 'Concerns', kind: 'string' },
  drafting_notes: { section: 'Goals & Notes', label: 'Drafting notes', kind: 'string' },
  assets: { section: 'Assets', label: 'Assets', kind: 'assets' },
} satisfies Partial<Record<DesignSheetImportField, FieldMeta>>

export type KnownDesignSheetImportField = keyof typeof DESIGN_SHEET_IMPORT_FIELDS

const ASSET_CATEGORIES = new Set<AssetItem['category']>([
  'real_property',
  'financial',
  'retirement',
  'life_insurance',
  'business',
  'other',
])

const CHILD_RELATIONSHIPS = new Set<DesignSheetChild['relationship']>([
  'biological',
  'adopted',
  'stepchild',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['yes', 'y', 'true', 'include', 'included'].includes(normalized)) return true
  if (['no', 'n', 'false', 'omit', 'omitted'].includes(normalized)) return false
  return null
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(/[$,%\s,]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function coerceChildren(value: unknown): DesignSheetChild[] | null {
  if (!Array.isArray(value)) return null

  const children = value
    .filter(isRecord)
    .map(child => {
      const name = coerceString(child.name)
      if (!name) return null

      const rawRelationship = coerceString(child.relationship)
      const relationship = rawRelationship && CHILD_RELATIONSHIPS.has(rawRelationship as DesignSheetChild['relationship'])
        ? rawRelationship as DesignSheetChild['relationship']
        : 'biological'

      return {
        name,
        dob: coerceString(child.dob ?? child.date_of_birth),
        relationship,
        is_minor: coerceBoolean(child.is_minor) ?? false,
      }
    })
    .filter((child): child is DesignSheetChild => child !== null)

  return children.length ? children : null
}

function coerceAssets(value: unknown): AssetItem[] | null {
  if (!Array.isArray(value)) return null

  const assets = value
    .filter(isRecord)
    .map(asset => {
      const description = coerceString(asset.description)
      if (!description) return null

      const rawCategory = coerceString(asset.category)
      const category = rawCategory && ASSET_CATEGORIES.has(rawCategory as AssetItem['category'])
        ? rawCategory as AssetItem['category']
        : 'other'

      return {
        id: crypto.randomUUID(),
        category,
        description,
        institution: coerceString(asset.institution) ?? '',
        estimated_value: coerceNumber(asset.estimated_value),
        notes: coerceString(asset.notes) ?? '',
      }
    })
    .filter((asset): asset is AssetItem => asset !== null)

  return assets.length ? assets : null
}

function coerceJson(value: unknown): unknown | null {
  return isEmptyValue(value) ? null : value
}

function isKnownImportField(field: string): field is KnownDesignSheetImportField {
  return field in DESIGN_SHEET_IMPORT_FIELDS
}

export function getDesignSheetImportTextValidationError(text: string): string | null {
  if (!text.trim()) return 'text required'
  if (text.trim().length < MIN_DESIGN_SHEET_IMPORT_TEXT_LENGTH) return 'text too short (20 char min)'
  if (text.length > MAX_DESIGN_SHEET_IMPORT_TEXT_LENGTH) return 'text too long (60k char max)'
  return null
}

export function getDesignSheetDocxValidationError(file: File | null): string | null {
  if (!file) return 'No file provided'
  const isDocx = file.name.toLowerCase().endsWith('.docx') || file.type === DOCX_MIME_TYPE
  if (!isDocx) return 'Only Word .docx documents are supported'
  if (file.size > MAX_DESIGN_SHEET_DOCX_BYTES) return 'Word document is too large (10 MB max)'
  return null
}

export function coerceDesignSheetImport(parsed: unknown): DesignSheetImportProposal {
  if (!isRecord(parsed)) return {}

  const proposed: DesignSheetImportProposal = {}

  for (const [field, meta] of Object.entries(DESIGN_SHEET_IMPORT_FIELDS) as Array<[KnownDesignSheetImportField, FieldMeta]>) {
    if (!(field in parsed)) continue

    const rawValue = parsed[field]
    let value: unknown = null

    if (meta.kind === 'string') value = coerceString(rawValue)
    if (meta.kind === 'boolean') value = coerceBoolean(rawValue)
    if (meta.kind === 'number') value = coerceNumber(rawValue)
    if (meta.kind === 'children') value = coerceChildren(rawValue)
    if (meta.kind === 'assets') value = coerceAssets(rawValue)
    if (meta.kind === 'json') value = coerceJson(rawValue)

    if (!isEmptyValue(value)) {
      proposed[field] = value
    }
  }

  return proposed
}

export function formatDesignSheetImportValue(value: unknown): string {
  if (isEmptyValue(value)) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (isRecord(item) && typeof item.name === 'string' && item.name.trim()) return item.name.trim()
        if (isRecord(item) && typeof item.description === 'string' && item.description.trim()) {
          return item.description.trim()
        }
        return JSON.stringify(item)
      })
      .join('; ')
  }
  return JSON.stringify(value)
}

export function buildDesignSheetImportPreview(args: {
  currentSheet: Record<string, unknown> | null
  proposed: DesignSheetImportProposal
}): DesignSheetImportPreviewRow[] {
  const currentSheet = args.currentSheet ?? {}

  return Object.entries(args.proposed)
    .filter(([field, proposedValue]) => isKnownImportField(field) && !isEmptyValue(proposedValue))
    .map(([field, proposedValue]) => {
      const knownField = field as KnownDesignSheetImportField
      const meta = DESIGN_SHEET_IMPORT_FIELDS[knownField]
      const currentValue = currentSheet[knownField]
      const replacement =
        !isEmptyValue(currentValue) &&
        stableStringify(currentValue) !== stableStringify(proposedValue)

      return {
        field: knownField,
        label: meta.label,
        section: meta.section,
        currentValue,
        proposedValue,
        currentDisplay: formatDesignSheetImportValue(currentValue),
        proposedDisplay: formatDesignSheetImportValue(proposedValue),
        selected: !replacement,
        replacement,
      }
    })
}
