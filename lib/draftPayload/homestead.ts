import { getPersistedRealEstateTransfer } from '@/lib/designSheetRealEstateTransfer'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

export interface DraftPayloadHomestead {
  beneficiary_names: string
  primary_beneficiary_name: string
  beneficiary_pronoun_possessive: string
  trustee_pronoun_possessive: string
  servicemember_names: string
  property_address_line: string
  trust_deed_book: string
  trust_deed_page: string
  deed_registry_district: string
  deed_book: string
  deed_page: string
  certificate_number: string
  land_court_document_number: string
}

function joinNames(names: string[]): string {
  const filtered = names.map(name => name.trim()).filter(Boolean)
  if (filtered.length === 0) return ''
  if (filtered.length === 1) return filtered[0]
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`
  return `${filtered.slice(0, -1).join(', ')}, and ${filtered[filtered.length - 1]}`
}

function possessiveForNames(count: number): string {
  if (count === 1) return 'his/her'
  return 'their'
}

export function draftPayloadHomestead(
  designSheet: Pick<DesignSheetRow, 'client_name' | 'spouse_name' | 'street' | 'city' | 'decisions'> | null,
): DraftPayloadHomestead {
  const transfer = getPersistedRealEstateTransfer({
    decisions: designSheet?.decisions ?? null,
  })

  const deed = transfer.deedFields
  const clientName = designSheet?.client_name?.trim() ?? ''
  const spouseName = designSheet?.spouse_name?.trim() ?? ''

  const beneficialOwnerNames = transfer.beneficialOwners
    .map(owner => owner.customName?.trim())
    .filter((name): name is string => Boolean(name))

  const beneficiaryNames = beneficialOwnerNames.length > 0
    ? joinNames(beneficialOwnerNames)
    : joinNames([clientName, spouseName].filter(Boolean))

  const primaryBeneficiary = beneficialOwnerNames[0] ?? clientName
  const beneficiaryCount = beneficialOwnerNames.length > 0
    ? beneficialOwnerNames.length
    : [clientName, spouseName].filter(Boolean).length

  const street = deed.property_address?.trim() || designSheet?.street?.trim() || ''
  const city = deed.property_city?.trim() || designSheet?.city?.trim() || ''
  const propertyAddressLine = [street, city].filter(Boolean).join(', ')

  return {
    beneficiary_names: beneficiaryNames,
    primary_beneficiary_name: primaryBeneficiary,
    beneficiary_pronoun_possessive: possessiveForNames(beneficiaryCount),
    trustee_pronoun_possessive: 'his/her/their',
    servicemember_names: '',
    property_address_line: propertyAddressLine,
    trust_deed_book: '',
    trust_deed_page: '',
    deed_registry_district: deed.registry_district?.trim() ?? '',
    deed_book: deed.prior_deed_book?.trim() ?? '',
    deed_page: deed.prior_deed_page?.trim() ?? '',
    certificate_number: deed.certificate_number?.trim() ?? '',
    land_court_document_number: '',
  }
}
