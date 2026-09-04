import {
  getContactProfiles,
  getFiduciaryDocumentInclusions,
  type FiduciaryDocumentInclusions,
} from '@/lib/designSheet/fiduciaryDocumentInclusions'
import { principalOrderByPriority } from '@/lib/designSheet/fiduciarySlotOrdering'
import { formatPhoneDisplay } from '@/lib/phone'
import { realNameOrNull } from '@/lib/draftPayload/placeholderNames'
import { getRelationshipLabel, structuredFromContactProfile } from '@/lib/kinship/relationshipLabels'
import type { ContactRow, DesignSheetRow, FiduciarySlotRow } from '@/lib/draftPayload/types'

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

export interface DraftPayloadContactDetail {
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  date_of_birth: string | null
  relationship: string | null
}

export interface DraftPayloadFiduciaryRoleDetails {
  executor: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    successor: DraftPayloadContactDetail | null
    co_successor: DraftPayloadContactDetail | null
    second_successor: DraftPayloadContactDetail | null
  }
  spouse_executor: {
    primary: DraftPayloadContactDetail | null
    successor: DraftPayloadContactDetail | null
  }
  trustee: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    successor: DraftPayloadContactDetail | null
    co_successor: DraftPayloadContactDetail | null
    second_successor: DraftPayloadContactDetail | null
    co_second_successor: DraftPayloadContactDetail | null
  }
  agent: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    successor: DraftPayloadContactDetail | null
  }
  spouse_agent: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    successor: DraftPayloadContactDetail | null
  }
  healthcare_agent: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    alternate: DraftPayloadContactDetail | null
    co_alternate: DraftPayloadContactDetail | null
    /** Slot 2 — the HCP form's third agent line; the sheet allows unlimited alternates. */
    second_alternate?: DraftPayloadContactDetail | null
  }
  spouse_healthcare_agent: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    alternate: DraftPayloadContactDetail | null
    co_alternate: DraftPayloadContactDetail | null
  }
  guardians: {
    primary: DraftPayloadContactDetail | null
    co_primary: DraftPayloadContactDetail | null
    successor: DraftPayloadContactDetail | null
    co_successor: DraftPayloadContactDetail | null
    second_successor: DraftPayloadContactDetail | null
    co_second_successor: DraftPayloadContactDetail | null
    temporary: DraftPayloadContactDetail | null
    temporary_co: DraftPayloadContactDetail | null
    temporary_successor: DraftPayloadContactDetail | null
    temporary_second_successor: DraftPayloadContactDetail | null
  }
}

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ')
}

function contactName(contact: ContactRow): string | null {
  // See realNameOrNull: a placeholder is treated as an unfilled slot, not a name.
  return realNameOrNull(fullName(contact.first_name, contact.last_name))
}

function contactRelationship(
  contact: ContactRow,
  designSheet: DesignSheetRow | null,
  perspective: 'client' | 'spouse',
): string | null {
  const profiles = designSheet ? getContactProfiles(designSheet) : {}
  const profile = profiles[contact.id]
  const structured = structuredFromContactProfile(profile)
  const kindLabel = getRelationshipLabel(structured, perspective)
  if (kindLabel) return kindLabel

  const label = contact.relationship_label?.trim()
  if (label) return label
  return contact.relationship_type?.trim() || null
}

function contactToDetail(
  contact: ContactRow,
  designSheet: DesignSheetRow | null,
  perspective: 'client' | 'spouse',
): DraftPayloadContactDetail {
  return {
    full_name: contactName(contact) ?? '',
    phone: formatPhoneDisplay(contact.phone) || null,
    email: contact.email?.trim() || null,
    address: contact.address_line1?.trim() || null,
    date_of_birth: contact.date_of_birth?.trim() || null,
    relationship: contactRelationship(contact, designSheet, perspective),
  }
}

/**
 * The client or the spouse, as a person who can hold a fiduciary role.
 *
 * A slot filled by the client or the spouse themselves does not point at a
 * `contacts` row — they are not their own contact — so their details have to be
 * passed in. Carrying only a name and an address is what made
 * `healthcare.agent.primary.phone` blank on every Health Care Proxy where the
 * spouse is the agent, which in estate planning is most of them.
 */
export interface FiduciaryPerson {
  full_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  date_of_birth: string | null
}

/**
 * A fiduciary who is the client or the spouse rather than a contact.
 *
 * This used to return `phone`, `email` and `date_of_birth` as an unconditional
 * `null`, which is worse than it sounds: the generator emits
 * `[[ MISSING: healthcare.agent.primary.phone ]]` into the document, the draft
 * preflight reports the blank, and the attorney is sent to Fiduciary Role
 * Assignment to fill it — where the spouse is already correctly named and there
 * is no field to change. A blank nobody can fill is worse than a blank, because
 * it costs someone the trip.
 *
 * Phone is formatted the same way `contactToDetail` formats a contact's, so a
 * document does not read differently depending on whether the agent happened to
 * be the spouse or someone with a contact row.
 */
function personDetail(
  person: FiduciaryPerson | null | undefined,
  relationship: string | null | undefined,
): DraftPayloadContactDetail | null {
  const name = person?.full_name?.trim()
  if (!name) return null
  return {
    full_name: name,
    phone: formatPhoneDisplay(person?.phone) || null,
    email: person?.email?.trim() || null,
    address: person?.address?.trim() || null,
    date_of_birth: person?.date_of_birth?.trim() || null,
    relationship: relationship?.trim() || null,
  }
}

function isFiduciarySlotArray(value: unknown): value is FiduciarySlotRow[] {
  return Array.isArray(value) && value.every(slot => {
    if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) return false
    const row = slot as Record<string, unknown>
    return typeof row.id === 'string' &&
      (typeof row.contact_id === 'string' || row.contact_id === null) &&
      typeof row.is_co === 'boolean' &&
      typeof row.order === 'number'
  })
}

function getDesignSlots(
  designSheet: DesignSheetRow | null,
  key: keyof Pick<
    DesignSheetRow,
    | 'trustee_slots'
    | 'executor_slots'
    | 'poa_slots'
    | 'hcp_slots'
    | 'guardian_slots'
    | 'temporary_guardian_slots'
    | 'spouse_trustee_slots'
    | 'spouse_executor_slots'
    | 'spouse_poa_slots'
    | 'spouse_hcp_slots'
  >,
): FiduciarySlotRow[] {
  const direct = designSheet?.[key]
  if (isFiduciarySlotArray(direct)) return direct
  const fromDecisions = designSheet?.decisions?.[key]
  return isFiduciarySlotArray(fromDecisions) ? fromDecisions : []
}

function emptyRoleDetails(): DraftPayloadFiduciaryRoleDetails {
  const emptyPerson = null
  return {
    executor: {
      primary: emptyPerson,
      co_primary: emptyPerson,
      successor: emptyPerson,
      co_successor: emptyPerson,
      second_successor: emptyPerson,
    },
    spouse_executor: {
      primary: emptyPerson,
      successor: emptyPerson,
    },
    trustee: {
      primary: emptyPerson,
      co_primary: emptyPerson,
      successor: emptyPerson,
      co_successor: emptyPerson,
      second_successor: emptyPerson,
      co_second_successor: emptyPerson,
    },
    agent: {
      primary: emptyPerson,
      co_primary: emptyPerson,
      successor: emptyPerson,
    },
  spouse_agent: {
    primary: emptyPerson,
    co_primary: emptyPerson,
    successor: emptyPerson,
  },
    healthcare_agent: {
      primary: emptyPerson,
      co_primary: emptyPerson,
      alternate: emptyPerson,
      co_alternate: emptyPerson,
      second_alternate: emptyPerson,
    },
    spouse_healthcare_agent: {
      primary: emptyPerson,
      co_primary: emptyPerson,
      alternate: emptyPerson,
      co_alternate: emptyPerson,
    },
    guardians: {
      primary: emptyPerson,
      co_primary: emptyPerson,
      successor: emptyPerson,
      co_successor: emptyPerson,
      second_successor: emptyPerson,
      co_second_successor: emptyPerson,
      temporary: emptyPerson,
      temporary_co: emptyPerson,
      temporary_successor: emptyPerson,
      temporary_second_successor: emptyPerson,
    },
  }
}

export function buildFiduciaryRoleDetailsFromDesignSheet(
  designSheet: DesignSheetRow | null,
  contacts: ContactRow[],
  client: FiduciaryPerson,
  spouse: FiduciaryPerson | null,
): DraftPayloadFiduciaryRoleDetails {
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]))
  const details = emptyRoleDetails()

  function slotContact(slots: FiduciarySlotRow[], order: number, co = false): ContactRow | null {
    const priorityOrder = principalOrderByPriority(slots, order)
    if (priorityOrder == null) return null
    // Require a named slot — a stray empty placeholder at the same order must
    // not shadow the appointed person.
    const slot = slots.find(item => item.order === priorityOrder && item.is_co === co && Boolean(item.contact_id))
    return slot?.contact_id ? contactsById.get(slot.contact_id) ?? null : null
  }

  function slotDetail(
    slots: FiduciarySlotRow[],
    order: number,
    co = false,
    perspective: 'client' | 'spouse' = 'client',
  ): DraftPayloadContactDetail | null {
    const priorityOrder = principalOrderByPriority(slots, order)
    if (priorityOrder == null) return null
    const slot = slots.find(item => item.order === priorityOrder && item.is_co === co && Boolean(item.contact_id))
    if (!slot) return null

    if (slot.contact_id === CLIENT_PRIMARY_CONTACT_ID) {
      return personDetail(client, 'Spouse')
    }
    if (slot.contact_id === SPOUSE_PRIMARY_CONTACT_ID) {
      return personDetail(spouse, 'Spouse')
    }

    const contact = slot.contact_id ? contactsById.get(slot.contact_id) ?? null : null
    if (!contact) return null
    const detail = contactToDetail(contact, designSheet, perspective)
    // A placeholder name resolves to an empty `full_name`. Returning the detail
    // anyway would appoint a nameless fiduciary; returning null makes the slot
    // read as unfilled, which is what it is. `resolveContactDetails` already
    // filters the same way for the HIPAA agent lists.
    return detail.full_name ? detail : null
  }

  const trustee = getDesignSlots(designSheet, 'trustee_slots')
  details.trustee.primary = slotDetail(trustee, 0)
  details.trustee.co_primary = slotDetail(trustee, 0, true)
  details.trustee.successor = slotDetail(trustee, 1)
  details.trustee.co_successor = slotDetail(trustee, 1, true)
  details.trustee.second_successor = slotDetail(trustee, 2)
  details.trustee.co_second_successor = slotDetail(trustee, 2, true)

  const executor = getDesignSlots(designSheet, 'executor_slots')
  details.executor.primary = slotDetail(executor, 0)
  details.executor.co_primary = slotDetail(executor, 0, true)
  details.executor.successor = slotDetail(executor, 1)
  details.executor.co_successor = slotDetail(executor, 1, true)
  details.executor.second_successor = slotDetail(executor, 2)

  const poa = getDesignSlots(designSheet, 'poa_slots')
  details.agent.primary = slotDetail(poa, 0)
  details.agent.co_primary = slotDetail(poa, 0, true)
  details.agent.successor = slotDetail(poa, 1)

  const hcp = getDesignSlots(designSheet, 'hcp_slots')
  details.healthcare_agent.primary = slotDetail(hcp, 0)
  details.healthcare_agent.co_primary = slotDetail(hcp, 0, true)
  details.healthcare_agent.alternate = slotDetail(hcp, 1)
  details.healthcare_agent.co_alternate = slotDetail(hcp, 1, true)
  details.healthcare_agent.second_alternate = slotDetail(hcp, 2)

  const guardian = getDesignSlots(designSheet, 'guardian_slots')
  details.guardians.primary = slotDetail(guardian, 0)
  details.guardians.co_primary = slotDetail(guardian, 0, true)
  details.guardians.successor = slotDetail(guardian, 1)
  details.guardians.co_successor = slotDetail(guardian, 1, true)
  details.guardians.second_successor = slotDetail(guardian, 2)
  details.guardians.co_second_successor = slotDetail(guardian, 2, true)

  const tempGuardian = getDesignSlots(designSheet, 'temporary_guardian_slots')
  details.guardians.temporary = slotDetail(tempGuardian, 0)
  details.guardians.temporary_co = slotDetail(tempGuardian, 0, true)
  details.guardians.temporary_successor = slotDetail(tempGuardian, 1)
  details.guardians.temporary_second_successor = slotDetail(tempGuardian, 2)

  const spouseExecutor = getDesignSlots(designSheet, 'spouse_executor_slots')
  details.spouse_executor.primary = slotDetail(spouseExecutor, 0, false, 'spouse')
  details.spouse_executor.successor = slotDetail(spouseExecutor, 1, false, 'spouse')

  const spousePoa = getDesignSlots(designSheet, 'spouse_poa_slots')
  details.spouse_agent.primary = slotDetail(spousePoa, 0, false, 'spouse')
  details.spouse_agent.co_primary = slotDetail(spousePoa, 0, true, 'spouse')
  details.spouse_agent.successor = slotDetail(spousePoa, 1, false, 'spouse')

  const spouseHcp = getDesignSlots(designSheet, 'spouse_hcp_slots')
  details.spouse_healthcare_agent.primary = slotDetail(spouseHcp, 0, false, 'spouse')
  details.spouse_healthcare_agent.co_primary = slotDetail(spouseHcp, 0, true, 'spouse')
  details.spouse_healthcare_agent.alternate = slotDetail(spouseHcp, 1, false, 'spouse')
  details.spouse_healthcare_agent.co_alternate = slotDetail(spouseHcp, 1, true, 'spouse')

  return details
}

export function resolveContactDetails(
  contactIds: string[],
  contacts: ContactRow[],
  designSheet: DesignSheetRow | null,
  perspective: 'client' | 'spouse' = 'client',
): DraftPayloadContactDetail[] {
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]))
  return contactIds
    .map(id => contactsById.get(id) ?? null)
    .filter((contact): contact is ContactRow => contact !== null)
    .map(contact => contactToDetail(contact, designSheet, perspective))
    .filter(detail => detail.full_name.length > 0)
}

export function getDraftPayloadFiduciaryDisplay(
  designSheet: Pick<DesignSheetRow, 'decisions'>,
): FiduciaryDocumentInclusions {
  return getFiduciaryDocumentInclusions(designSheet)
}

export function generatorPersonFromContactDetail(
  detail: DraftPayloadContactDetail | null | undefined,
  fallbackName: string | null | undefined,
  fallbackExtra: Record<string, unknown> = {},
  display: FiduciaryDocumentInclusions,
): Record<string, unknown> {
  const fullName = detail?.full_name?.trim() || fallbackName?.trim() || ''
  const result: Record<string, unknown> = {
    full_name: fullName,
    ...fallbackExtra,
  }

  if (display.show_phone && detail?.phone) result.phone = detail.phone
  if (display.show_email && detail?.email) result.email = detail.email
  if (display.show_address) {
    const address = detail?.address ?? (typeof fallbackExtra.address === 'string' ? fallbackExtra.address : null)
    if (address) result.address = address
  }
  if (display.show_dob && detail?.date_of_birth) result.date_of_birth = detail.date_of_birth
  if (display.show_relationship) {
    const relationship = detail?.relationship
      ?? (typeof fallbackExtra.relationship === 'string' ? fallbackExtra.relationship : null)
    if (relationship) result.relationship = relationship
  }

  return result
}
