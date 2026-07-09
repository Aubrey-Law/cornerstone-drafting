import { setDocumentInclusion } from '@/lib/designSheetDocumentInclusions'
import {
  coerceRealEstateTransferFields,
  type RealEstateTransferDocType,
  type RealEstateTransferFields,
} from '@/lib/realEstateTransfer/fields'
import {
  emptyRealEstateTransferFormState,
  type BeneficialOwnerEntry,
  type FiduciaryParty,
  type PartySelection,
  type RealEstateTransferFormState,
} from '@/lib/realEstateTransfer/formState'
import type { DesignSheet, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface PersistedRealEstateTransferState {
  realtyTrustName: string
  realtyTrustDate: string
  trusteeSource: RealEstateTransferFormState['trusteeSource']
  trusteeFiduciaryId: string
  beneficialOwners: BeneficialOwnerEntry[]
  grantees: PartySelection[]
  deedFields: RealEstateTransferFields
  extraTrustNames: string[]
  selectedDocs: RealEstateTransferDocType[]
  uploadName: string | null
  hasExtracted: boolean
}

function emptyPersistedState(): PersistedRealEstateTransferState {
  return {
    realtyTrustName: '',
    realtyTrustDate: '',
    trusteeSource: 'client',
    trusteeFiduciaryId: '',
    beneficialOwners: [],
    grantees: [],
    deedFields: {},
    extraTrustNames: [],
    selectedDocs: ['deed', 'trustees_certificate', 'real_estate_trust'],
    uploadName: null,
    hasExtracted: false,
  }
}

function readPartySelections(raw: unknown): PartySelection[] {
  if (!Array.isArray(raw)) return []
  const result: PartySelection[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.source !== 'string') continue
    result.push({
      id: item.id,
      source: item.source as PartySelection['source'],
      trustName: typeof item.trustName === 'string' ? item.trustName : undefined,
      customName: typeof item.customName === 'string' ? item.customName : undefined,
    })
  }
  return result
}

function readBeneficialOwners(raw: unknown): BeneficialOwnerEntry[] {
  if (!Array.isArray(raw)) return []
  const result: BeneficialOwnerEntry[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.source !== 'string') continue
    result.push({
      id: item.id,
      source: item.source as BeneficialOwnerEntry['source'],
      trustName: typeof item.trustName === 'string' ? item.trustName : undefined,
      customName: typeof item.customName === 'string' ? item.customName : undefined,
      percentage: typeof item.percentage === 'string' ? item.percentage : '',
    })
  }
  return result
}

function readDocTypes(raw: unknown): RealEstateTransferDocType[] {
  if (!Array.isArray(raw)) return emptyPersistedState().selectedDocs
  const allowed = new Set<RealEstateTransferDocType>(['deed', 'trustees_certificate', 'real_estate_trust'])
  return raw.filter((item): item is RealEstateTransferDocType => typeof item === 'string' && allowed.has(item as RealEstateTransferDocType))
}

export function getPersistedRealEstateTransfer(
  sheet: Pick<DesignSheet, 'decisions'>,
): PersistedRealEstateTransferState {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = isRecord(decisions.real_estate_transfer) ? decisions.real_estate_transfer : {}
  const defaults = emptyPersistedState()

  return {
    realtyTrustName: typeof raw.realtyTrustName === 'string' ? raw.realtyTrustName : defaults.realtyTrustName,
    realtyTrustDate: typeof raw.realtyTrustDate === 'string' ? raw.realtyTrustDate : defaults.realtyTrustDate,
    trusteeSource: raw.trusteeSource === 'spouse' || raw.trusteeSource === 'fiduciary'
      ? raw.trusteeSource
      : defaults.trusteeSource,
    trusteeFiduciaryId: typeof raw.trusteeFiduciaryId === 'string' ? raw.trusteeFiduciaryId : defaults.trusteeFiduciaryId,
    beneficialOwners: readBeneficialOwners(raw.beneficialOwners),
    grantees: readPartySelections(raw.grantees),
    deedFields: coerceRealEstateTransferFields(raw.deedFields),
    extraTrustNames: Array.isArray(raw.extraTrustNames)
      ? raw.extraTrustNames.filter((item): item is string => typeof item === 'string')
      : defaults.extraTrustNames,
    selectedDocs: readDocTypes(raw.selectedDocs),
    uploadName: typeof raw.uploadName === 'string' ? raw.uploadName : defaults.uploadName,
    hasExtracted: raw.hasExtracted === true,
  }
}

export function setPersistedRealEstateTransfer(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<PersistedRealEstateTransferState>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = getPersistedRealEstateTransfer(sheet)

  return {
    ...decisions,
    real_estate_transfer: {
      ...current,
      ...patch,
    },
  }
}

export function collectTrustNames(
  sheet: Pick<DesignSheet, 'trust_name' | 'spouse_trust_name'>,
  extraTrustNames: string[] = [],
): string[] {
  const names = [sheet.trust_name, sheet.spouse_trust_name, ...extraTrustNames]
    .map(name => (name ?? '').trim())
    .filter(Boolean)
  return [...new Set(names)]
}

function resolveContactName(
  contactId: string,
  contacts: MatterContact[],
  sheet: Pick<DesignSheet, 'client_name' | 'spouse_name'>,
  matter: Pick<PipelineMatter, 'client_name' | 'spouse_name'>,
): string | null {
  if (contactId === CLIENT_PRIMARY_CONTACT_ID) {
    return (sheet.client_name ?? matter.client_name ?? '').trim() || null
  }
  if (contactId === SPOUSE_PRIMARY_CONTACT_ID) {
    return (sheet.spouse_name ?? matter.spouse_name ?? '').trim() || null
  }
  const contact = contacts.find(item => item.id === contactId)
  if (!contact) return null
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
  return name || null
}

const FIDUCIARY_SLOT_FIELDS = [
  'trustee_slots',
  'spouse_trustee_slots',
  'executor_slots',
  'poa_slots',
] as const

export function collectFiduciaryParties(
  sheet: Pick<DesignSheet, typeof FIDUCIARY_SLOT_FIELDS[number] | 'client_name' | 'spouse_name'>,
  matter: Pick<PipelineMatter, 'client_name' | 'spouse_name'>,
  contacts: MatterContact[],
): FiduciaryParty[] {
  const seen = new Set<string>()
  const result: FiduciaryParty[] = []

  for (const field of FIDUCIARY_SLOT_FIELDS) {
    const slots = (sheet[field] ?? []) as FiduciarySlot[]
    for (const slot of slots) {
      if (!slot.contact_id || seen.has(slot.contact_id)) continue
      const name = resolveContactName(slot.contact_id, contacts, sheet, matter)
      if (!name) continue
      seen.add(slot.contact_id)
      result.push({ id: slot.contact_id, name })
    }
  }

  return result
}

export function buildFormStateFromDesignSheet(
  sheet: DesignSheet,
  matter: PipelineMatter,
  contacts: MatterContact[],
): RealEstateTransferFormState {
  const persisted = getPersistedRealEstateTransfer(sheet)
  const base = emptyRealEstateTransferFormState()

  return {
    ...base,
    clientName: (sheet.client_name ?? matter.client_name ?? '').trim(),
    spouseName: (sheet.spouse_name ?? matter.spouse_name ?? '').trim(),
    clientPropertyAddress: (sheet.street ?? '').trim(),
    clientPropertyCity: (sheet.city ?? '').trim(),
    clientPropertyState: (sheet.state ?? '').trim() || 'MA',
    clientPropertyCounty: (sheet.county ?? '').trim(),
    trustNames: collectTrustNames(sheet, persisted.extraTrustNames),
    fiduciaries: collectFiduciaryParties(sheet, matter, contacts),
    realtyTrustName: persisted.realtyTrustName,
    realtyTrustDate: persisted.realtyTrustDate,
    trusteeSource: persisted.trusteeSource,
    trusteeFiduciaryId: persisted.trusteeFiduciaryId,
    beneficialOwners: persisted.beneficialOwners,
    grantees: persisted.grantees,
    deedFields: persisted.deedFields,
  }
}

export function extractPersistedState(
  form: RealEstateTransferFormState,
  sheet: Pick<DesignSheet, 'trust_name' | 'spouse_trust_name'>,
): Omit<PersistedRealEstateTransferState, 'selectedDocs' | 'uploadName' | 'hasExtracted'> {
  const sheetTrustNames = new Set(collectTrustNames(sheet))
  return {
    realtyTrustName: form.realtyTrustName,
    realtyTrustDate: form.realtyTrustDate,
    trusteeSource: form.trusteeSource,
    trusteeFiduciaryId: form.trusteeFiduciaryId,
    beneficialOwners: form.beneficialOwners,
    grantees: form.grantees,
    deedFields: form.deedFields,
    extraTrustNames: form.trustNames.filter(name => !sheetTrustNames.has(name)),
  }
}

export function hasRealEstateTransferData(form: RealEstateTransferFormState): boolean {
  return Boolean(
    form.realtyTrustName.trim()
    || form.grantees.length > 0
    || form.beneficialOwners.length > 0
    || Object.values(form.deedFields).some(value => (value ?? '').trim()),
  )
}

export function commitRealEstateTransferToSheet(
  sheet: Pick<DesignSheet, 'decisions' | 'trust_name' | 'spouse_trust_name'>,
  form: RealEstateTransferFormState,
  meta?: Partial<Pick<PersistedRealEstateTransferState, 'selectedDocs' | 'uploadName' | 'hasExtracted'>>,
): Record<string, unknown> {
  let decisions: Record<string, unknown> = setPersistedRealEstateTransfer(sheet, {
    ...extractPersistedState(form, sheet),
    ...meta,
  })

  if (hasRealEstateTransferData(form)) {
    decisions = setDocumentInclusion({ decisions }, 'deed', true)
  }

  return decisions
}
