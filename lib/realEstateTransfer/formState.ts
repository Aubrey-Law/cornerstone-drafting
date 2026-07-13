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
  /** Preferred: matter contact id (or design-sheet client/spouse shortcut ids). */
  trusteeContactId: string
  /** @deprecated Prefer trusteeContactId; retained for read/write compat. */
  trusteeSource: 'client' | 'spouse' | 'fiduciary'
  /** @deprecated Prefer trusteeContactId; retained for read/write compat. */
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
    trusteeContactId: '',
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
  const contactId = form.trusteeContactId.trim()
  if (contactId) {
    if (contactId === '__design_sheet_client__') return form.clientName.trim()
    if (contactId === '__design_sheet_spouse__') return form.spouseName.trim()
    const fiduciary = form.fiduciaries.find(item => item.id === contactId)
    if (fiduciary?.name.trim()) return fiduciary.name.trim()
  }

  // Legacy fallback when only trusteeSource / trusteeFiduciaryId are set.
  if (form.trusteeSource === 'client') return form.clientName.trim()
  if (form.trusteeSource === 'spouse') return form.spouseName.trim()
  const fiduciary = form.fiduciaries.find(item => item.id === form.trusteeFiduciaryId)
  return fiduciary?.name.trim() ?? ''
}

/** Keep legacy source fields aligned with the contact-id selection. */
export function deriveLegacyTrusteeFields(
  trusteeContactId: string,
): Pick<RealEstateTransferFormState, 'trusteeSource' | 'trusteeFiduciaryId'> {
  if (!trusteeContactId || trusteeContactId === '__design_sheet_client__') {
    return { trusteeSource: 'client', trusteeFiduciaryId: '' }
  }
  if (trusteeContactId === '__design_sheet_spouse__') {
    return { trusteeSource: 'spouse', trusteeFiduciaryId: '' }
  }
  return { trusteeSource: 'fiduciary', trusteeFiduciaryId: trusteeContactId }
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
  // The uploaded deed describes the property being transferred. Client contact
  // information is only a fallback when the deed does not identify the property.
  const propertyAddress = deed.property_address?.trim() || form.clientPropertyAddress.trim() || ''
  const propertyCity = deed.property_city?.trim() || form.clientPropertyCity.trim() || ''
  const propertyState = deed.property_state?.trim() || form.clientPropertyState.trim() || ''
  const propertyCounty = deed.property_county?.trim() || form.clientPropertyCounty.trim() || ''

  return {
    ...deed,
    grantor: deed.grantor?.trim().toUpperCase() || '',
    grantor_2: deed.grantor_2?.trim().toUpperCase() || '',
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
    property_description: deed.property_description?.trim() || deed.legal_description?.trim() || '',
    recording_date: deed.recording_date?.trim() || deed.prior_deed_date?.trim() || '',
    registry_of_deeds: deed.registry_of_deeds?.trim() || deed.registry_district?.trim() || '',
    current_deed_book_number: deed.current_deed_book_number?.trim() || deed.prior_deed_book?.trim() || '',
    current_deed_page: deed.current_deed_page?.trim() || deed.prior_deed_page?.trim() || '',
    current_certificate_number: deed.current_certificate_number?.trim() || deed.certificate_number?.trim() || '',
    grantee_mailing_address: deed.grantee_mailing_address?.trim()
      || [propertyAddress, propertyCity, propertyState].filter(Boolean).join(', '),
    trust_term_extension_years: deed.trust_term_extension_years?.trim() || '21',
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
