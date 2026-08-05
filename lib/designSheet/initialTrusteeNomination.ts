import type { DesignSheet, FiduciarySlot, MatterContact } from '@/types/database'
import type { InitialTrusteeNomination } from '@/lib/designSheetTrustDetails'
import {
  firstAvailablePrincipalOrder,
  namedPrincipalSlots,
  principalSlotsByPriority,
} from '@/lib/designSheet/fiduciarySlotOrdering'

function primaryContactId(slots: FiduciarySlot[] | null | undefined): string | null {
  return namedPrincipalSlots(slots ?? [])[0]?.contact_id ?? null
}

function createSlot(order: number, is_co = false): FiduciarySlot {
  return { id: crypto.randomUUID(), contact_id: null, is_co, order }
}

function setPrimaryContact(slots: FiduciarySlot[] | null | undefined, contactId: string | null): FiduciarySlot[] {
  const existing = slots ?? []
  const primary = principalSlotsByPriority(existing)[0]
  if (!primary) {
    return [{ id: crypto.randomUUID(), contact_id: contactId, is_co: false, order: firstAvailablePrincipalOrder(existing) }, ...existing]
  }
  return existing.map(slot => slot.id === primary.id ? { ...slot, contact_id: contactId } : slot)
}

function setSlotContact(slots: FiduciarySlot[], slotId: string, contactId: string | null): FiduciarySlot[] {
  return slots.map(slot => slot.id === slotId ? { ...slot, contact_id: contactId } : slot)
}

function addCo(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  const idx = slots.findIndex(slot => slot.order === order && !slot.is_co)
  if (idx === -1) return slots
  const next = [...slots]
  const lastCoIdx = next.reduce((lastIdx, slot, i) => (
    slot.order === order && slot.is_co ? i : lastIdx
  ), idx)
  next.splice(lastCoIdx + 1, 0, createSlot(order, true))
  return next
}

function removeCoForOrder(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  const coSlots = slots.filter(slot => slot.order === order && slot.is_co)
  if (coSlots.length === 0) return slots
  return slots.filter(slot => slot.id !== coSlots[coSlots.length - 1].id)
}

export type NormalizedTrusteeNomination = 'client' | 'spouse' | 'client_and_spouse' | 'other'

export function normalizeTrusteeNomination(
  value: InitialTrusteeNomination | null | undefined,
): NormalizedTrusteeNomination | null {
  if (!value) return null
  if (value === 'grantor' || value === 'client') return 'client'
  if (value === 'grantor_and_spouse' || value === 'client_and_spouse') return 'client_and_spouse'
  if (value === 'spouse') return 'spouse'
  return 'other'
}

export function nominationOptionsForContext(ctx: {
  married: boolean
  jointTrust: boolean
  scope: 'client' | 'spouse' | 'single'
  clientFirst: string
  spouseFirst: string
}): Array<{ value: InitialTrusteeNomination; label: string }> {
  const clientLabel = ctx.clientFirst || 'Client'
  const spouseLabel = ctx.spouseFirst || 'Spouse'

  if (!ctx.married || ctx.scope === 'single') {
    return [
      { value: 'grantor', label: 'Grantor' },
      { value: 'single_initial_trustee', label: 'Single Initial Trustee' },
    ]
  }

  if (ctx.jointTrust) {
    return [
      { value: 'client', label: clientLabel },
      { value: 'spouse', label: spouseLabel },
      { value: 'client_and_spouse', label: `${clientLabel} and ${spouseLabel}` },
      { value: 'single_initial_trustee', label: 'Other' },
    ]
  }

  if (ctx.scope === 'spouse') {
    return [
      { value: 'spouse', label: spouseLabel },
      { value: 'client_and_spouse', label: `${spouseLabel} and ${clientLabel}` },
      { value: 'single_initial_trustee', label: 'Other' },
    ]
  }

  return [
    { value: 'client', label: clientLabel },
    { value: 'client_and_spouse', label: `${clientLabel} and ${spouseLabel}` },
    { value: 'single_initial_trustee', label: 'Other' },
  ]
}

export function applyInitialTrusteeNomination(
  slots: FiduciarySlot[] | null | undefined,
  nomination: InitialTrusteeNomination | null | undefined,
  clientContact: MatterContact | null,
  spouseContact: MatterContact | null,
): FiduciarySlot[] {
  const normalized = normalizeTrusteeNomination(nomination)
  let next = slots ?? []

  if (!normalized || normalized === 'other') {
    return next
  }

  const primaryId = primaryContactId(next)
  const primarySlot = principalSlotsByPriority(next)[0]
  const previousPrimaryOrder = primarySlot?.order

  if (normalized === 'client' && clientContact) {
    const oldPrimaryId = primarySlot?.contact_id
    next = setPrimaryContact(next, clientContact.id)
    if (previousPrimaryOrder != null && oldPrimaryId && oldPrimaryId !== clientContact.id) {
      next = removeCoForOrder(next, previousPrimaryOrder)
    }
    return next
  }

  if (normalized === 'spouse' && spouseContact) {
    const oldPrimaryId = primarySlot?.contact_id
    next = setPrimaryContact(next, spouseContact.id)
    if (previousPrimaryOrder != null && oldPrimaryId && oldPrimaryId !== spouseContact.id) {
      next = removeCoForOrder(next, previousPrimaryOrder)
    }
    return next
  }

  if (normalized === 'client_and_spouse' && clientContact && spouseContact) {
    const oldPrimaryId = primarySlot?.contact_id
    next = setPrimaryContact(next, clientContact.id)
    if (previousPrimaryOrder != null && oldPrimaryId && oldPrimaryId !== clientContact.id) {
      next = removeCoForOrder(next, previousPrimaryOrder)
    }
    const primaryOrder = principalSlotsByPriority(next)[0]?.order ?? firstAvailablePrincipalOrder(next)
    const coSlot = next.find(slot => slot.order === primaryOrder && slot.is_co)
    if (!coSlot) {
      next = addCo(next, primaryOrder)
    }
    const refreshedCo = next.find(slot => slot.order === primaryOrder && slot.is_co)
    if (refreshedCo) {
      next = setSlotContact(next, refreshedCo.id, spouseContact.id)
    }
    return next
  }

  if (!primarySlot) {
    return next
  }

  return next
}

export function applyTrusteeNominationsFromSheet(
  sheet: DesignSheet,
  trustDetails: {
    initial_trustee_nomination?: InitialTrusteeNomination | null
    spouse_initial_trustee_nomination?: InitialTrusteeNomination | null
  },
  clientContact: MatterContact | null,
  spouseContact: MatterContact | null,
): Pick<DesignSheet, 'trustee_slots' | 'spouse_trustee_slots'> {
  const married = Boolean((sheet.marital_status ?? '').toLowerCase().includes('married'))
  const separate = married && sheet.is_joint === false

  const trustee_slots = applyInitialTrusteeNomination(
    sheet.trustee_slots,
    trustDetails.initial_trustee_nomination,
    clientContact,
    spouseContact,
  ) as DesignSheet['trustee_slots']

  const spouse_trustee_slots = separate
    ? applyInitialTrusteeNomination(
        sheet.spouse_trustee_slots,
        trustDetails.spouse_initial_trustee_nomination,
        clientContact,
        spouseContact,
      ) as DesignSheet['spouse_trustee_slots']
    : sheet.spouse_trustee_slots

  return { trustee_slots, spouse_trustee_slots }
}
