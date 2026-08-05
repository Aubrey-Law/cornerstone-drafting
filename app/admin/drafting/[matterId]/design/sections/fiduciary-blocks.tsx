'use client'

import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import type { DesignSheet, FiduciaryRole, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'
import { firstAvailablePrincipalOrder, namedPrincipalSlots, principalSlotsByPriority } from './fiduciary-helpers'

export const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
export const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

export const SLOT_FIELDS: Record<FiduciaryRole, keyof DesignSheet> = {
  trustee: 'trustee_slots',
  executor: 'executor_slots',
  poa: 'poa_slots',
  hcp: 'hcp_slots',
  guardian: 'guardian_slots',
  temporary_guardian: 'temporary_guardian_slots',
}

export type FiduciarySlotField =
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

export type FiduciaryGridRole =
  | 'trustee' | 'executor' | 'poa' | 'hcp' | 'guardian' | 'temporary_guardian'

/**
 * Roles appointed per person: each spouse has their own will, POA and health care
 * documents, and their own trust when the trusts are separate.
 */
export type FiduciaryPartyRole = 'trustee' | 'executor' | 'poa' | 'hcp'

/**
 * Roles appointed for the children rather than for a parent. Both spouses name the
 * same guardians in their own wills, so there is one set, shown once — putting it
 * under each party tab implied a choice per parent that does not exist.
 */
export type FiduciarySharedRole = 'guardian' | 'temporary_guardian'

export const SHARED_SLOT_FIELDS: Record<FiduciarySharedRole, FiduciarySlotField> = {
  guardian: 'guardian_slots',
  temporary_guardian: 'temporary_guardian_slots',
}

export const CLIENT_SLOT_FIELDS: Record<FiduciaryPartyRole, FiduciarySlotField> = {
  trustee: 'trustee_slots',
  executor: 'executor_slots',
  poa: 'poa_slots',
  hcp: 'hcp_slots',
}

export const SPOUSE_SLOT_FIELDS: Record<FiduciaryPartyRole, FiduciarySlotField> = {
  trustee: 'spouse_trustee_slots',
  executor: 'spouse_executor_slots',
  poa: 'spouse_poa_slots',
  hcp: 'spouse_hcp_slots',
}

/**
 * Which slot arrays the spouse tab writes to.
 *
 * A joint trust is one instrument with one line of successor trustees, so both
 * parties share `trustee_slots`; only separate trusts get a second set. The
 * spouse's will, POA and health care documents are always their own, joint trust
 * or not. Readiness already required a spouse trustee only when the trusts are
 * separate — this stops the UI offering a second set that nothing would read.
 */
export function spouseSlotFields(
  sheet: Pick<DesignSheet, 'is_joint'>,
): Record<FiduciaryPartyRole, FiduciarySlotField> {
  const separateTrusts = sheet.is_joint === false
  return {
    ...SPOUSE_SLOT_FIELDS,
    trustee: separateTrusts ? 'spouse_trustee_slots' : 'trustee_slots',
  }
}

export function isMarriedSheet(sheet: DesignSheet) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  return marital.includes('married') && !marital.includes('never')
}

/** Full display name for party tabs / section labels (sheet first, then matter). */
export function partyFullName(
  sheet: DesignSheet,
  matter: PipelineMatter,
  party: 'client' | 'spouse',
): string {
  if (party === 'client') {
    return (sheet.client_name ?? matter.client_name ?? '').trim() || 'Client'
  }
  return (sheet.spouse_name ?? matter.spouse_name ?? '').trim() || 'Spouse / Partner'
}

/** Client / spouse segmented tabs for fiduciary role assignment when married. */
export function PartyTabs({
  value,
  onChange,
  clientLabel,
  spouseLabel,
}: {
  value: 'client' | 'spouse'
  onChange: (v: 'client' | 'spouse') => void
  clientLabel: string
  spouseLabel: string
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]" role="tablist" aria-label="Party">
      {([
        { id: 'client' as const, label: clientLabel },
        { id: 'spouse' as const, label: spouseLabel },
      ]).map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex-1 rounded-md px-3 py-2 text-[13px] transition-all',
            value === tab.id
              ? 'bg-card font-semibold text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function splitDisplayName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first_name: parts[0] ?? name, last_name: '' }
  return {
    first_name: parts.slice(0, -1).join(' '),
    last_name: parts.at(-1) ?? '',
  }
}

export function findSpouseContact(contacts: MatterContact[], matter: PipelineMatter, sheet: DesignSheet): MatterContact | null {
  const spouseName = (sheet.spouse_name ?? matter.spouse_name ?? '').trim()
  if (!spouseName) return null
  const normalized = spouseName.toLowerCase()
  const existing = contacts.find(contact => `${contact.first_name} ${contact.last_name}`.trim().toLowerCase() === normalized)
  if (existing) return existing
  return {
    id: SPOUSE_PRIMARY_CONTACT_ID,
    ...splitDisplayName(spouseName),
    relationship: 'Spouse',
    phone: formatPhoneDisplay(sheet.spouse_phone ?? matter.spouse_phone) || null,
    email: sheet.spouse_email ?? matter.spouse_email ?? null,
    address: matter.spouse_address ?? ([sheet.street, sheet.city, sheet.state, sheet.zip].filter(Boolean).join(', ') || null),
  }
}

export function findClientContact(contacts: MatterContact[], matter: PipelineMatter, sheet: DesignSheet): MatterContact | null {
  const clientName = (sheet.client_name ?? matter.client_name ?? '').trim()
  if (!clientName) return null
  const normalized = clientName.toLowerCase()
  const existing = contacts.find(contact => `${contact.first_name} ${contact.last_name}`.trim().toLowerCase() === normalized)
  if (existing) return existing
  return {
    id: CLIENT_PRIMARY_CONTACT_ID,
    ...splitDisplayName(clientName),
    relationship: 'Client',
    phone: formatPhoneDisplay(sheet.client_phone) || null,
    email: sheet.client_email ?? null,
    address: [sheet.street, sheet.city, sheet.state, sheet.zip].filter(Boolean).join(', ') || null,
  }
}

export function primaryContactId(slots: FiduciarySlot[] | null | undefined): string | null {
  return namedPrincipalSlots(slots ?? [])[0]?.contact_id ?? null
}

export function setPrimaryContact(slots: FiduciarySlot[] | null | undefined, contactId: string | null): FiduciarySlot[] {
  const existing = slots ?? []
  const primary = principalSlotsByPriority(existing)[0]

  if (!primary) {
    const nextOrder = firstAvailablePrincipalOrder(existing)
    return [
      { id: crypto.randomUUID(), contact_id: contactId, is_co: false, order: nextOrder },
      ...existing,
    ]
  }

  return existing.map(slot => slot.id === primary.id ? { ...slot, contact_id: contactId } : slot)
}

export function clearPrimaryContactIf(slots: FiduciarySlot[] | null | undefined, contactId: string): FiduciarySlot[] {
  const existing = slots ?? []
  const primary = principalSlotsByPriority(existing)[0]
  if (!primary || primary.contact_id !== contactId) return existing
  return existing.map(slot => (
    slot.id === primary.id
      ? { ...slot, contact_id: null }
      : slot
  ))
}

export function cloneSlots(slots: FiduciarySlot[] | null | undefined): FiduciarySlot[] {
  return (slots ?? []).map(slot => ({ ...slot, id: crypto.randomUUID() }))
}

/** Map synthetic client/spouse shortcut ids to real contact rows when available. */
export function resolveSlotContactIds(
  slots: FiduciarySlot[],
  clientContact: MatterContact | null,
  spouseContact: MatterContact | null,
): FiduciarySlot[] {
  return slots.map(slot => {
    if (!slot.contact_id) return slot
    if (
      slot.contact_id === CLIENT_PRIMARY_CONTACT_ID
      && clientContact?.id
      && clientContact.id !== CLIENT_PRIMARY_CONTACT_ID
    ) {
      return { ...slot, contact_id: clientContact.id }
    }
    if (
      slot.contact_id === SPOUSE_PRIMARY_CONTACT_ID
      && spouseContact?.id
      && spouseContact.id !== SPOUSE_PRIMARY_CONTACT_ID
    ) {
      return { ...slot, contact_id: spouseContact.id }
    }
    return slot
  })
}

export function SegControl({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
            value === o.value
              ? 'bg-card font-semibold text-primary shadow-sm'
              : 'text-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
