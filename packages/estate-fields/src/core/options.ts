import type { FieldOption } from './types'

export const MA_COUNTY_OPTIONS: FieldOption[] = [
  'Barnstable', 'Berkshire', 'Bristol', 'Dukes', 'Essex', 'Franklin',
  'Hampden', 'Hampshire', 'Middlesex', 'Nantucket', 'Norfolk', 'Plymouth',
  'Suffolk', 'Worcester',
].map((c) => ({ value: c, label: c }))

export const PRONOUN_OPTIONS: FieldOption[] = [
  { value: 'he/him', label: 'He/Him' },
  { value: 'she/her', label: 'She/Her' },
  { value: 'they/them', label: 'They/Them' },
  { value: 'ze/zir', label: 'Ze/Zir' },
  { value: 'other', label: 'Other' },
]

export const SUFFIX_OPTIONS: FieldOption[] = [
  'Jr.', 'Sr.', 'II', 'III', 'IV', 'Esq.',
].map((s) => ({ value: s, label: s }))

export const MARITAL_STATUS_OPTIONS: FieldOption[] = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
  { value: 'domestic_partner', label: 'Domestic partner' },
]

export const CITIZENSHIP_OPTIONS: FieldOption[] = [
  { value: 'US Citizen', label: 'US Citizen' },
  { value: 'Permanent Resident', label: 'Permanent Resident' },
  { value: 'Non-Resident Alien', label: 'Non-Resident Alien' },
]

export const CHILD_RELATIONSHIP_OPTIONS: FieldOption[] = [
  { value: 'biological', label: 'Biological' },
  { value: 'adopted', label: 'Adopted' },
  { value: 'stepchild', label: 'Stepchild' },
]

export function childParentageOptions(ctx: {
  clientName?: string | null
  spouseName?: string | null
}): FieldOption[] {
  const clientLabel = (ctx.clientName ?? '').trim() || 'Client'
  const spouseLabel = (ctx.spouseName ?? '').trim() || 'Spouse / Partner'
  return [
    { value: 'joint', label: 'Joint (both)' },
    { value: 'client', label: clientLabel },
    { value: 'spouse', label: spouseLabel },
  ]
}

export const MARITAL_STATUS_VALUES = MARITAL_STATUS_OPTIONS.map((o) => o.value)
export const CITIZENSHIP_VALUES = CITIZENSHIP_OPTIONS.map((o) => o.value)
