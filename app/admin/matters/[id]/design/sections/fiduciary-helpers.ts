import type { FiduciarySlot, FiduciaryRole } from '@/types/database'

// ── Slot factories ───────────────────────────────────────────────────────────

export function createSlot(order: number, is_co = false): FiduciarySlot {
  return { id: crypto.randomUUID(), contact_id: null, is_co, order }
}

export function defaultPrimarySlot(): FiduciarySlot[] {
  return [createSlot(0)]
}

// ── Slot mutations (all return new arrays) ──────────────────────────────────

export function addAlternate(slots: FiduciarySlot[]): FiduciarySlot[] {
  const maxOrder = slots.length > 0 ? Math.max(...slots.map(s => s.order)) : -1
  return [...slots, createSlot(maxOrder + 1)]
}

export function removeAlternate(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  if (order === 0) return slots // never remove primary
  const filtered = slots.filter(s => s.order !== order)
  // Re-number: orders above the removed one shift down by 1
  return filtered.map(s => s.order > order ? { ...s, order: s.order - 1 } : s)
}

export function addCo(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  if (coSlotsForOrder(slots, order).length >= 3) return slots
  const idx = slots.findIndex(s => s.order === order && !s.is_co)
  if (idx === -1) return slots
  const next = [...slots]
  const lastCoIdx = next.reduce((lastIdx, slot, i) => (
    slot.order === order && slot.is_co ? i : lastIdx
  ), idx)
  next.splice(lastCoIdx + 1, 0, createSlot(order, true))
  return next
}

export function removeCo(slots: FiduciarySlot[], slotId: string): FiduciarySlot[] {
  return slots.filter(s => s.id !== slotId)
}

export function removeCoForOrder(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  const coSlots = coSlotsForOrder(slots, order)
  if (coSlots.length === 0) return slots
  return removeCo(slots, coSlots[coSlots.length - 1].id)
}

export function coSlotsForOrder(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  return slots.filter(s => s.order === order && s.is_co)
}

export function setSlotContact(
  slots: FiduciarySlot[],
  slotId: string,
  contactId: string | null
): FiduciarySlot[] {
  return slots.map(s => s.id === slotId ? { ...s, contact_id: contactId } : s)
}

// ── Slot grouping ────────────────────────────────────────────────────────────

export interface SlotGroup {
  principal: FiduciarySlot
  coSlots: FiduciarySlot[]
}

export function slotsByOrder(slots: FiduciarySlot[]): SlotGroup[] {
  const map = new Map<number, SlotGroup>()

  // Sort by order then is_co (principals first)
  const sorted = [...slots].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.is_co === b.is_co ? 0 : a.is_co ? 1 : -1
  })

  for (const s of sorted) {
    const existing = map.get(s.order)
    if (s.is_co) {
      if (existing) existing.coSlots.push(s)
    } else {
      if (!existing) map.set(s.order, { principal: s, coSlots: [] })
      else existing.principal = s
    }
  }

  return Array.from(map.values())
}

// ── Role configuration ───────────────────────────────────────────────────────

export interface RoleConfig {
  title: string
  primaryLabel: string
  altLabel: string
  coLabel: string
  allowCo: boolean
  maxCo: number
}

export const ROLE_CONFIG: Record<FiduciaryRole, RoleConfig> = {
  trustee: {
    title: 'Trustee',
    primaryLabel: 'Primary Trustee',
    altLabel: 'Alternate Trustee',
    coLabel: 'Co-Trustee',
    allowCo: true,
    maxCo: 3,
  },
  executor: {
    title: 'Executor / Personal Representative',
    primaryLabel: 'Primary Executor',
    altLabel: 'Alternate Executor',
    coLabel: 'Co-Executor',
    allowCo: true,
    maxCo: 3,
  },
  poa: {
    title: 'Durable Power of Attorney',
    primaryLabel: 'Primary Agent',
    altLabel: 'Alternate Agent',
    coLabel: 'Co-Agent',
    allowCo: true,
    maxCo: 3,
  },
  hcp: {
    title: 'Healthcare Proxy',
    primaryLabel: 'Primary Agent',
    altLabel: 'Alternate Agent',
    coLabel: 'Co-Agent',
    allowCo: false, // HCP cannot have co-agents
    maxCo: 0,
  },
  guardian: {
    title: 'Guardian',
    primaryLabel: 'Primary Guardian',
    altLabel: 'Alternate Guardian',
    coLabel: 'Co-Guardian',
    allowCo: true,
    maxCo: 1,
  },
  temporary_guardian: {
    title: 'Temporary Guardian',
    primaryLabel: 'Primary Temporary Guardian',
    altLabel: 'Alternate Temporary Guardian',
    coLabel: 'Co-Temporary Guardian',
    allowCo: false,
    maxCo: 0,
  },
}
