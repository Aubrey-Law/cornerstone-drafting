import type { DesignSheet } from '@/types/database'

export type FiduciaryDocumentInclusionKey =
  | 'show_phone'
  | 'show_address'
  | 'show_email'
  | 'show_dob'
  | 'show_relationship'

export interface FiduciaryDocumentInclusions {
  show_phone: boolean
  show_address: boolean
  show_email: boolean
  show_dob: boolean
  show_relationship: boolean
}

export const FIDUCIARY_DOCUMENT_INCLUSION_OPTIONS: Array<{
  key: FiduciaryDocumentInclusionKey
  label: string
  help: string
}> = [
  {
    key: 'show_phone',
    label: 'Show fiduciary phone numbers in documents',
    help: 'Check this box to include fiduciary phone numbers in documents.',
  },
  {
    key: 'show_address',
    label: 'Show fiduciary addresses in documents',
    help: 'Check this box to include fiduciary addresses in documents.',
  },
  {
    key: 'show_email',
    label: 'Show fiduciary email addresses in documents',
    help: 'Check this box to include fiduciary email addresses in documents.',
  },
  {
    key: 'show_dob',
    label: 'Show fiduciary dates of birth in documents',
    help: 'Check this box to include fiduciary dates of birth when available.',
  },
  {
    key: 'show_relationship',
    label: 'Show fiduciary relationships in documents',
    help: 'Check this box to include fiduciary relationship descriptions in documents.',
  },
]

const DEFAULTS: FiduciaryDocumentInclusions = {
  show_phone: false,
  show_address: false,
  show_email: false,
  show_dob: false,
  show_relationship: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getFiduciaryDocumentInclusions(sheet: Pick<DesignSheet, 'decisions'>): FiduciaryDocumentInclusions {
  const decisions = sheet.decisions ?? {}
  const raw = isRecord(decisions.fiduciary_document_inclusions)
    ? decisions.fiduciary_document_inclusions
    : {}
  return {
    show_phone: raw.show_phone === true,
    show_address: raw.show_address === true,
    show_email: raw.show_email === true,
    show_dob: raw.show_dob === true,
    show_relationship: raw.show_relationship === true,
  }
}

export function setFiduciaryDocumentInclusion(
  sheet: Pick<DesignSheet, 'decisions'>,
  key: FiduciaryDocumentInclusionKey,
  checked: boolean,
): DesignSheet['decisions'] {
  const decisions = sheet.decisions ?? {}
  const current = getFiduciaryDocumentInclusions(sheet)
  return {
    ...decisions,
    fiduciary_document_inclusions: {
      ...DEFAULTS,
      ...current,
      [key]: checked,
    },
  }
}

export type FiduciaryEntityType =
  | 'individual'
  | 'independent_professional'
  | 'bank_institutional'
  | 'other_entity'

export type BeneficiaryEntityType = 'individual' | 'charity' | 'group'

export interface ContactProfile {
  fiduciary_type?: FiduciaryEntityType
  beneficiary_type?: BeneficiaryEntityType
  is_fiduciary?: boolean
  is_beneficiary?: boolean
  relationship_to?: 'client' | 'spouse' | 'joint' | 'other'
  relationship_detail?: string
  date_of_birth?: string | null
}

export function getContactProfiles(sheet: Pick<DesignSheet, 'decisions'>): Record<string, ContactProfile> {
  const decisions = sheet.decisions ?? {}
  const raw = decisions.contact_profiles
  if (!isRecord(raw)) return {}
  const out: Record<string, ContactProfile> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (isRecord(value)) out[id] = value as ContactProfile
  }
  return out
}

export function setContactProfile(
  sheet: Pick<DesignSheet, 'decisions'>,
  contactId: string,
  patch: Partial<ContactProfile>,
): DesignSheet['decisions'] {
  const decisions = sheet.decisions ?? {}
  const profiles = getContactProfiles(sheet)
  return {
    ...decisions,
    contact_profiles: {
      ...profiles,
      [contactId]: {
        ...profiles[contactId],
        ...patch,
      },
    },
  }
}

export function removeContactProfile(
  sheet: Pick<DesignSheet, 'decisions'>,
  contactId: string,
): DesignSheet['decisions'] {
  const decisions = sheet.decisions ?? {}
  const profiles = { ...getContactProfiles(sheet) }
  delete profiles[contactId]
  return {
    ...decisions,
    contact_profiles: profiles,
  }
}

export const FIDUCIARY_TYPE_OPTIONS: Array<{ value: FiduciaryEntityType; label: string }> = [
  { value: 'individual', label: 'Individual' },
  { value: 'independent_professional', label: 'Independent Professional Fiduciary' },
  { value: 'bank_institutional', label: 'Bank or Institutional Fiduciary' },
  { value: 'other_entity', label: 'Other Professional, Entity, or Firm' },
]

export const FIDUCIARY_TYPE_LABELS: Record<FiduciaryEntityType, string> = {
  individual: 'Individual',
  independent_professional: 'Independent Professional Fiduciary',
  bank_institutional: 'Bank or Institutional Fiduciary',
  other_entity: 'Other Professional, Entity, or Firm',
}

export const BENEFICIARY_TYPE_OPTIONS: Array<{ value: BeneficiaryEntityType; label: string }> = [
  { value: 'individual', label: 'Individual Person' },
  { value: 'charity', label: 'Charity' },
  { value: 'group', label: 'Group of Individuals' },
]

export const BENEFICIARY_TYPE_LABELS: Record<BeneficiaryEntityType, string> = {
  individual: 'Individual Person',
  charity: 'Charity',
  group: 'Group of Individuals',
}
