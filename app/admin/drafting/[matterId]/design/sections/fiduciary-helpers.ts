import type { FiduciarySlot, FiduciaryRole } from '@/types/database'
export {
  firstAvailablePrincipalOrder,
  namedPrincipalSlots,
  normalizeFiduciarySlots,
  principalSlotsByPriority,
  repairFiduciarySlotOrdering,
} from '@/lib/designSheet/fiduciarySlotOrdering'

// ── Slot factories ───────────────────────────────────────────────────────────

export function createSlot(order: number, is_co = false): FiduciarySlot {
  return { id: crypto.randomUUID(), contact_id: null, is_co, order }
}

export function defaultPrimarySlot(): FiduciarySlot[] {
  return [createSlot(0)]
}

/**
 * Repair corrupt slot arrays that cause "choose 1 → two names populate":
 * - duplicate slot ids (setSlotContact updates every match)
 * - multiple non-co principals at the same order (draft joins their names)
 */

// ── Slot mutations (all return new arrays) ──────────────────────────────────

export function addAlternate(slots: FiduciarySlot[]): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  const maxOrder = normalized.length > 0 ? Math.max(...normalized.map(s => s.order)) : -1
  return [...normalized, createSlot(maxOrder + 1)]
}

/** Add a backup/alternate principal at order >= 1 (backup-only UI sections). */
export function addBackupAgent(slots: FiduciarySlot[]): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  const backupOrders = normalized
    .filter(s => !s.is_co && s.order > 0)
    .map(s => s.order)
  const nextOrder = backupOrders.length > 0 ? Math.max(...backupOrders) + 1 : 1
  return [...normalized, createSlot(nextOrder)]
}

export function removeAlternate(slots: FiduciarySlot[], order: number): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  const firstPrincipalOrder = normalized
    .filter(slot => !slot.is_co)
    .sort((a, b) => a.order - b.order)[0]
    ?.order

  if (order === firstPrincipalOrder || firstPrincipalOrder == null) return normalized

  const filtered = normalized.filter(s => s.order !== order)
  // Re-number: orders above the removed one shift down by 1
  return normalizeFiduciarySlots(
    filtered.map(s => s.order > order ? { ...s, order: s.order - 1 } : s),
  )
}

export function addCo(
  slots: FiduciarySlot[],
  order: number,
  maxCo = 3,
): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  if (coSlotsForOrder(normalized, order).length >= maxCo) return normalized
  const idx = normalized.findIndex(s => s.order === order && !s.is_co)
  if (idx === -1) return normalized
  const next = [...normalized]
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
  const normalized = normalizeFiduciarySlots(slots)
  // Prefer exact id match after normalization; fall back to first match only once.
  let updated = false
  return normalized.map(s => {
    if (updated || s.id !== slotId) return s
    updated = true
    return { ...s, contact_id: contactId }
  })
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
    } else if (!existing) {
      // Keep the first principal at each order; extras are repaired on write.
      map.set(s.order, { principal: s, coSlots: [] })
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
    title: 'Personal Representative',
    primaryLabel: 'Primary Personal Representative',
    altLabel: 'Alternate Personal Representative',
    coLabel: 'Co-Personal Representative',
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
    allowCo: true,
    maxCo: 1,
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
    allowCo: true,
    maxCo: 1,
  },
}
