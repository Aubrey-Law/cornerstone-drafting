'use client'

import { useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import type { DesignSheet, FiduciaryRole, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'
import type { SlotState } from '@/types/planReview'
import type { SectionProps } from './shared'
import { FiduciaryRoleSection } from './FiduciaryRoleSection'
import { defaultPrimarySlot, normalizeFiduciarySlots } from './fiduciary-helpers'

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

export interface FiduciaryBlockProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  role: FiduciaryRole
  sameAsTrustee?: boolean
  onSameAsTrusteeToggle?: () => void
  sameAsTrusteeLabel?: string
  spouseOptionLabel?: string
  slotField?: FiduciarySlotField
  sectionTitle?: string
  primaryShortcutContact?: MatterContact | null
  primaryShortcutLabel?: string
  clientShortcutContact?: MatterContact | null
  clientShortcutLabel?: string
  coShortcutContact?: MatterContact | null
  coShortcutLabel?: string
  primaryLabel?: string
  altLabel?: string
  coLabel?: string
  slotScope?: 'all' | 'primary' | 'backup'
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

function slotsNeedContactIdResolution(
  slots: FiduciarySlot[],
  clientContact: MatterContact | null,
  spouseContact: MatterContact | null,
): boolean {
  return slots.some(slot => {
    if (!slot.contact_id) return false
    if (
      slot.contact_id === CLIENT_PRIMARY_CONTACT_ID
      && clientContact?.id
      && clientContact.id !== CLIENT_PRIMARY_CONTACT_ID
    ) return true
    if (
      slot.contact_id === SPOUSE_PRIMARY_CONTACT_ID
      && spouseContact?.id
      && spouseContact.id !== SPOUSE_PRIMARY_CONTACT_ID
    ) return true
    return false
  })
}

function slotsMissingPrimary(slots: FiduciarySlot[]): boolean {
  return !slots.some(slot => slot.order === 0 && !slot.is_co)
}

export function FiduciaryBlock({
  role,
  sheet,
  contacts,
  matter,
  onChange,
  onAddContact,
  onUpdateContact,
  sameAsTrustee,
  onSameAsTrusteeToggle,
  sameAsTrusteeLabel,
  spouseOptionLabel,
  slotField,
  sectionTitle,
  primaryShortcutContact,
  primaryShortcutLabel,
  clientShortcutContact,
  clientShortcutLabel,
  coShortcutContact,
  coShortcutLabel,
  primaryLabel,
  altLabel,
  coLabel,
  slotScope,
}: FiduciaryBlockProps) {
  const field = slotField ?? SLOT_FIELDS[role]
  const rawSlots = (sheet[field] as FiduciarySlot[] | null) ?? []
  const spouseContact = isMarriedSheet(sheet) ? findSpouseContact(contacts, matter, sheet) : null
  const clientContact = findClientContact(contacts, matter, sheet)

  const persistSlots = useCallback((
    updater: FiduciarySlot[] | ((prev: FiduciarySlot[]) => FiduciarySlot[]),
  ) => {
    onChange(field, prevSheet => {
      const current = (prevSheet[field] as FiduciarySlot[] | null) ?? []
      const resolvedCurrent = resolveSlotContactIds(current, clientContact, spouseContact)
      const next = typeof updater === 'function' ? updater(resolvedCurrent) : updater
      const resolved = resolveSlotContactIds(next, clientContact, spouseContact)
      return normalizeFiduciarySlots(resolved) as DesignSheet[keyof DesignSheet]
    })
  }, [clientContact, field, onChange, spouseContact])

  // Ensure a primary slot exists in persisted sheet state, not only in display memory.
  useEffect(() => {
    if (slotScope === 'backup') return
    if (!slotsMissingPrimary(rawSlots)) return
    onChange(field, prevSheet => {
      const current = (prevSheet[field] as FiduciarySlot[] | null) ?? []
      if (!slotsMissingPrimary(current)) return current as DesignSheet[typeof field]
      const next = [...defaultPrimarySlot(), ...current]
      const resolved = resolveSlotContactIds(next, clientContact, spouseContact)
      return normalizeFiduciarySlots(resolved) as DesignSheet[typeof field]
    })
  }, [clientContact, field, onChange, rawSlots, slotScope, spouseContact])

  // Upgrade legacy synthetic shortcut ids after contacts are loaded.
  useEffect(() => {
    if (!slotsNeedContactIdResolution(rawSlots, clientContact, spouseContact)) return
    onChange(field, prevSheet => {
      const current = (prevSheet[field] as FiduciarySlot[] | null) ?? []
      if (!slotsNeedContactIdResolution(current, clientContact, spouseContact)) {
        return current as DesignSheet[typeof field]
      }
      const resolved = resolveSlotContactIds(current, clientContact, spouseContact)
      return normalizeFiduciarySlots(resolved) as DesignSheet[typeof field]
    })
  }, [clientContact, field, onChange, rawSlots, spouseContact])

  const resolvedSlots = resolveSlotContactIds(rawSlots, clientContact, spouseContact)
  const slotsForDisplay = (() => {
    if (slotScope === 'backup') return resolvedSlots
    if (!slotsMissingPrimary(resolvedSlots)) return resolvedSlots
    return [...defaultPrimarySlot(), ...resolvedSlots]
  })()

  const handleSlotsChange = useCallback((
    updater: FiduciarySlot[] | ((prev: FiduciarySlot[]) => FiduciarySlot[]),
  ) => {
    persistSlots(updater)
  }, [persistSlots])

  const handleSlotStateChange = useCallback((slotId: string, state: SlotState) => {
    onChange('fiduciary_slot_states', prevSheet => ({
      ...(prevSheet.fiduciary_slot_states ?? {}),
      [slotId]: state,
    }))
  }, [onChange])

  const contactsForDisplay = [clientContact, spouseContact]
    .filter((c): c is MatterContact => Boolean(c))
    .reduce<MatterContact[]>((acc, c) => (acc.some(x => x.id === c.id) ? acc : [...acc, c]), contacts)

  return (
    <div
      id={designFieldTargetId(slotScope === 'backup' ? `${String(field)}:backup` : String(field))}
      tabIndex={-1}
    >
      <FiduciaryRoleSection
        role={role}
        slots={slotsForDisplay}
        contacts={contactsForDisplay}
        onSlotsChange={handleSlotsChange}
        onAddContact={data => onAddContact(data) as Promise<MatterContact>}
        onUpdateContact={onUpdateContact ? ((id, data) => onUpdateContact(id, data) as Promise<MatterContact>) : undefined}
        slotStates={sheet.fiduciary_slot_states}
        onSlotStateChange={handleSlotStateChange}
        sameAsTrustee={sameAsTrustee}
        onSameAsTrusteeToggle={onSameAsTrusteeToggle}
        sameAsTrusteeLabel={sameAsTrusteeLabel}
        spouseContact={spouseOptionLabel ? spouseContact : null}
        spouseOptionLabel={spouseOptionLabel}
        primaryShortcutContact={primaryShortcutContact ?? undefined}
        primaryShortcutLabel={primaryShortcutLabel}
        clientContact={clientShortcutContact ?? undefined}
        clientOptionLabel={clientShortcutLabel}
        coShortcutContact={coShortcutContact ?? undefined}
        coShortcutLabel={coShortcutLabel}
        primaryLabel={primaryLabel}
        altLabel={altLabel}
        coLabel={coLabel}
        slotScope={slotScope}
        title={sectionTitle}
      />
    </div>
  )
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
