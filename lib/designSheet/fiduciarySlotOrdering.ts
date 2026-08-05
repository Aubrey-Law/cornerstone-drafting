import type { FiduciarySlot } from '@/types/database'

/** Return non-co principals in descending priority order (numeric order ascending). */
export function principalSlotsByPriority(slots: FiduciarySlot[]): FiduciarySlot[] {
  return [...slots]
    .filter(slot => !slot.is_co)
    .sort((a, b) => a.order - b.order)
}

/** Return named non-co principals, then pick only those that are filled. */
export function namedPrincipalSlots(slots: FiduciarySlot[]): FiduciarySlot[] {
  return principalSlotsByPriority(slots).filter(slot => Boolean(slot.contact_id))
}

/**
 * Map a priority slot index (0=primary, 1=successor, 2=second successor)
 * to the underlying persisted slot order.
 */
export function principalOrderByPriority(
  slots: FiduciarySlot[],
  priority: number,
): number | null {
  return namedPrincipalSlots(slots)[priority]?.order ?? null
}

/**
 * Re-index principal orders to a compact sequence by priority and keep each co-agent
 * attached to its mapped principal order.
 */
export function repairFiduciarySlotOrdering(slots: FiduciarySlot[]): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  const orderedPrincipals = namedPrincipalSlots(normalized)
  const orderMap = new Map<number, number>()

  orderedPrincipals.forEach((slot, index) => {
    if (!orderMap.has(slot.order)) {
      orderMap.set(slot.order, index)
    }
  })

  const unchanged = normalized.every(slot => {
    const mapped = orderMap.get(slot.order)
    return mapped === undefined || mapped === slot.order
  })
  if (unchanged) return normalized

  return normalized.map(slot => {
    const mappedOrder = orderMap.get(slot.order)
    if (mappedOrder == null) return slot
    if (mappedOrder === slot.order) return slot
    return { ...slot, order: mappedOrder }
  })
}

/** Return the first free principal order for a new principal slot. */
export function firstAvailablePrincipalOrder(slots: FiduciarySlot[]): number {
  const used = new Set<number>(namedPrincipalSlots(slots).map(slot => slot.order))
  let order = 0
  while (used.has(order)) {
    order += 1
  }
  return order
}

/**
 * Normalize a slot list for safe persistence:
 * - unique IDs
 * - dedupe conflicting principal orders
 */
export function normalizeFiduciarySlots(slots: FiduciarySlot[]): FiduciarySlot[] {
  const seenIds = new Set<string>()
  const principalOrders = new Set<number>()
  const next: FiduciarySlot[] = []

  const sorted = [...slots].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.is_co === b.is_co ? 0 : a.is_co ? 1 : -1
  })

  for (const slot of sorted) {
    let id = slot.id
    if (!id || seenIds.has(id)) {
      id = crypto.randomUUID()
    }
    seenIds.add(id)

    if (!slot.is_co) {
      if (principalOrders.has(slot.order)) {
        if (!slot.contact_id) continue
        let order = slot.order + 1
        while (principalOrders.has(order)) order += 1
        principalOrders.add(order)
        next.push({ ...slot, id, order })
        continue
      }
      principalOrders.add(slot.order)
    }

    next.push(id === slot.id ? slot : { ...slot, id })
  }

  return next
}
