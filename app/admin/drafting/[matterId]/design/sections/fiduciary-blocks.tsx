'use client'

import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import type { DesignSheet, FiduciaryRole, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'

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

export type FiduciaryGridRole = 'trustee' | 'executor' | 'poa' | 'hcp' | 'guardian'

export const CLIENT_SLOT_FIELDS: Record<FiduciaryGridRole, FiduciarySlotField> = {
  trustee: 'trustee_slots',
  executor: 'executor_slots',
  poa: 'poa_slots',
  hcp: 'hcp_slots',
  guardian: 'guardian_slots',
}

export const SPOUSE_SLOT_FIELDS: Record<FiduciaryGridRole, FiduciarySlotField> = {
  trustee: 'spouse_trustee_slots',
  executor: 'spouse_executor_slots',
  poa: 'spouse_poa_slots',
  hcp: 'spouse_hcp_slots',
  // Guardians are appointed for the same children, so both party tabs share
  // the existing guardian slot array instead of introducing a new store.
  guardian: 'guardian_slots',
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
  return slots?.find(slot => slot.order === 0 && !slot.is_co)?.contact_id ?? null
}

export function setPrimaryContact(slots: FiduciarySlot[] | null | undefined, contactId: string | null): FiduciarySlot[] {
  const existing = slots ?? []
  const primary = existing.find(slot => slot.order === 0 && !slot.is_co)
  if (!primary) {
    return [
      { id: crypto.randomUUID(), contact_id: contactId, is_co: false, order: 0 },
      ...existing,
    ]
  }
  return existing.map(slot => slot.id === primary.id ? { ...slot, contact_id: contactId } : slot)
}

export function clearPrimaryContactIf(slots: FiduciarySlot[] | null | undefined, contactId: string): FiduciarySlot[] {
  return (slots ?? []).map(slot => (
    slot.order === 0 && !slot.is_co && slot.contact_id === contactId
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
