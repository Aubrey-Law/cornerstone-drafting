import {
  emptyRealEstateTransferFields,
  type RealEstateTransferFields,
} from './fields'

export type PartySource = 'client' | 'spouse' | 'trust' | 'realty_trust' | 'custom'

export interface FiduciaryParty {
  id: string
  name: string
}

export interface PartySelection {
  id: string
  source: PartySource
  trustName?: string
  customName?: string
}

export interface BeneficialOwnerEntry extends PartySelection {
  percentage: string
}

export interface RealEstateTransferFormState {
  clientName: string
  spouseName: string
  clientPropertyAddress: string
  clientPropertyCity: string
  clientPropertyState: string
  clientPropertyCounty: string
  trustNames: string[]
  realtyTrustName: string
  realtyTrustDate: string
  trusteeSource: 'client' | 'spouse' | 'fiduciary'
  trusteeFiduciaryId: string
  fiduciaries: FiduciaryParty[]
  beneficialOwners: BeneficialOwnerEntry[]
  grantees: PartySelection[]
  deedFields: RealEstateTransferFields
}

export function createId(): string {
  return crypto.randomUUID()
}

export function emptyRealEstateTransferFormState(): RealEstateTransferFormState {
  return {
    clientName: '',
    spouseName: '',
    clientPropertyAddress: '',
    clientPropertyCity: '',
    clientPropertyState: 'MA',
    clientPropertyCounty: '',
    trustNames: [],
    realtyTrustName: '',
    realtyTrustDate: '',
    trusteeSource: 'client',
    trusteeFiduciaryId: '',
    fiduciaries: [],
    beneficialOwners: [],
    grantees: [],
    deedFields: emptyRealEstateTransferFields(),
  }
}

export function clientLastName(clientName: string): string {
  const parts = clientName.trim().split(/\s+/)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

export function streetAddressForTrustName(address: string): string {
  return address.trim().split(',')[0]?.trim() ?? ''
}

export function suggestRealtyTrustNames(form: RealEstateTransferFormState): string[] {
  const suggestions: string[] = []
  const street = streetAddressForTrustName(form.clientPropertyAddress)
  if (street) suggestions.push(`${street} Realty Trust`)
  const lastName = clientLastName(form.clientName)
  if (lastName) suggestions.push(`${lastName} Realty Trust`)
  return [...new Set(suggestions)]
}

function resolvePartyName(
  selection: PartySelection,
  form: RealEstateTransferFormState,
): string {
  switch (selection.source) {
    case 'client':
      return form.clientName.trim()
    case 'spouse':
      return form.spouseName.trim()
    case 'trust':
      return selection.trustName?.trim() ?? ''
    case 'realty_trust':
      return form.realtyTrustName.trim()
    case 'custom':
      return selection.customName?.trim() ?? ''
    default:
      return ''
  }
}

function resolveTrusteeName(form: RealEstateTransferFormState): string {
  if (form.trusteeSource === 'client') return form.clientName.trim()
  if (form.trusteeSource === 'spouse') return form.spouseName.trim()
  const fiduciary = form.fiduciaries.find(item => item.id === form.trusteeFiduciaryId)
  return fiduciary?.name.trim() ?? ''
}

function formatGranteeLine(name: string, form: RealEstateTransferFormState): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  if (trimmed === form.realtyTrustName.trim()) {
    const trustee = resolveTrusteeName(form)
    if (trustee) return `${trustee}, Trustee of the ${trimmed}`
  }
  return trimmed
}

export function formatBeneficialOwners(form: RealEstateTransferFormState): string {
  return form.beneficialOwners
    .map(entry => {
      const name = resolvePartyName(entry, form)
      if (!name) return ''
      const pct = entry.percentage.trim()
      return pct ? `${name} (${pct}%)` : name
    })
    .filter(Boolean)
    .join('; ')
}

export function formatGrantees(form: RealEstateTransferFormState): string {
  return form.grantees
    .map(entry => formatGranteeLine(resolvePartyName(entry, form), form))
    .filter(Boolean)
    .join('; ')
}

export function buildTemplateFields(form: RealEstateTransferFormState): RealEstateTransferFields {
  const deed = form.deedFields
  const propertyAddress = form.clientPropertyAddress.trim() || deed.property_address?.trim() || ''
  const propertyCity = form.clientPropertyCity.trim() || deed.property_city?.trim() || ''
  const propertyState = form.clientPropertyState.trim() || deed.property_state?.trim() || ''
  const propertyCounty = form.clientPropertyCounty.trim() || deed.property_county?.trim() || ''

  return {
    ...deed,
    grantor: deed.grantor?.trim() || '',
    grantee: formatGrantees(form) || deed.grantee?.trim() || '',
    trustees: resolveTrusteeName(form) || deed.trustees?.trim() || '',
    settlor: form.clientName.trim() || deed.settlor?.trim() || '',
    trust_name: form.realtyTrustName.trim() || deed.trust_name?.trim() || '',
    trust_date: form.realtyTrustDate.trim() || deed.trust_date?.trim() || '',
    beneficial_owners: formatBeneficialOwners(form),
    property_address: propertyAddress,
    property_city: propertyCity,
    property_state: propertyState,
    property_county: propertyCounty,
  }
}

export function mergeExtractedDeedFields(
  form: RealEstateTransferFormState,
  extracted: RealEstateTransferFields,
): RealEstateTransferFormState {
  return {
    ...form,
    deedFields: {
      ...form.deedFields,
      ...extracted,
    },
    clientPropertyAddress: form.clientPropertyAddress || extracted.property_address || '',
    clientPropertyCity: form.clientPropertyCity || extracted.property_city || '',
    clientPropertyState: form.clientPropertyState || extracted.property_state || 'MA',
    clientPropertyCounty: form.clientPropertyCounty || extracted.property_county || '',
  }
}

export function partySourceLabel(source: PartySource): string {
  switch (source) {
    case 'client':
      return 'Client'
    case 'spouse':
      return 'Spouse'
    case 'trust':
      return 'Trust name'
    case 'realty_trust':
      return 'Realty trust'
    case 'custom':
      return 'Custom'
    default:
      return source
  }
}
