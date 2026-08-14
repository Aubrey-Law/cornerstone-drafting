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
 *
 * Empty placeholder slots are dropped: an unnamed principal parked at order 0
 * (every new sheet seeds one) shadowed the real line of succession — the first
 * real appointee rendered as "2nd" because normalization pushed the named slot
 * up past the empty one, and order-keyed payload lookups resolved to the blank
 * slot. Co slots whose line has no named principal are dropped with them.
 */
export function repairFiduciarySlotOrdering(slots: FiduciarySlot[]): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  const named = normalized.filter(slot => Boolean(slot.contact_id))
  const namedPrincipalOrders = new Set(
    named.filter(slot => !slot.is_co).map(slot => slot.order),
  )
  const kept = named.filter(slot => !slot.is_co || namedPrincipalOrders.has(slot.order))

  const orderedPrincipals = namedPrincipalSlots(kept)
  const orderMap = new Map<number, number>()
  orderedPrincipals.forEach((slot, index) => {
    if (!orderMap.has(slot.order)) {
      orderMap.set(slot.order, index)
    }
  })

  const unchanged = kept.length === normalized.length && kept.every(slot => {
    const mapped = orderMap.get(slot.order)
    return mapped === undefined || mapped === slot.order
  })
  if (unchanged) return normalized

  return kept.map(slot => {
    const mappedOrder = orderMap.get(slot.order)
    if (mappedOrder == null) return slot
    if (mappedOrder === slot.order) return slot
    return { ...slot, order: mappedOrder }
  })
}

/**
 * Remove a contact from a role entirely: their principal slot (taking that
 * line's co-agents with it — a co-agent pairs with a specific principal) or
 * their co slot, then compact the remaining line of succession.
 */
export function removeFiduciaryContact(slots: FiduciarySlot[], contactId: string): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots)
  const principalOrders = new Set(
    normalized
      .filter(slot => !slot.is_co && slot.contact_id === contactId)
      .map(slot => slot.order),
  )
  return repairFiduciarySlotOrdering(normalized.filter(slot => (
    slot.contact_id !== contactId
    && !(slot.is_co && principalOrders.has(slot.order))
  )))
}

/**
 * Move a named principal one line up (-1) or down (+1) in the succession,
 * swapping with its neighbor. Co-agents ride along with their principal's line.
 */
export function movePrincipalSlot(
  slots: FiduciarySlot[],
  contactId: string,
  delta: -1 | 1,
): FiduciarySlot[] {
  const repaired = repairFiduciarySlotOrdering(slots)
  const principals = namedPrincipalSlots(repaired)
  const index = principals.findIndex(slot => slot.contact_id === contactId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= principals.length) return repaired
  const orderA = principals[index].order
  const orderB = principals[target].order
  return repaired.map(slot => {
    if (slot.order === orderA) return { ...slot, order: orderB }
    if (slot.order === orderB) return { ...slot, order: orderA }
    return slot
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
