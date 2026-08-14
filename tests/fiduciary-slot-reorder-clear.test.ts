import { describe, expect, it } from 'vitest'
import type { FiduciarySlot } from '@/types/database'
import {
  movePrincipalSlot,
  namedPrincipalSlots,
  removeFiduciaryContact,
  repairFiduciarySlotOrdering,
} from '@/lib/designSheet/fiduciarySlotOrdering'
import { toggleFiduciaryGridContact } from '@/app/admin/drafting/[matterId]/design/sections/FiduciaryGrid'
import { ROLE_CONFIG } from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-helpers'

const slot = (over: Partial<FiduciarySlot>): FiduciarySlot => ({
  id: over.id ?? crypto.randomUUID(),
  contact_id: null,
  is_co: false,
  order: 0,
  ...over,
})

/** Every new sheet seeds one empty principal per role — the bug's trigger. */
const seeded = () => [slot({ id: 'seed', contact_id: null, order: 0 })]

const successionIds = (slots: FiduciarySlot[]) =>
  namedPrincipalSlots(slots).map(s => s.contact_id)

describe('repairFiduciarySlotOrdering with empty placeholder slots', () => {
  it('drops the seeded empty slot so the first appointee holds order 0', () => {
    const repaired = repairFiduciarySlotOrdering([
      slot({ id: 'seed', contact_id: null, order: 0 }),
      slot({ id: 'a', contact_id: 'A', order: 1 }),
    ])
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ contact_id: 'A', order: 0 })
  })

  it('drops co slots whose line has no named principal', () => {
    const repaired = repairFiduciarySlotOrdering([
      slot({ contact_id: 'A', order: 0 }),
      slot({ contact_id: 'orphan-co', order: 3, is_co: true }),
    ])
    expect(repaired.map(s => s.contact_id)).toEqual(['A'])
  })

  it('keeps co slots attached to their principal through compaction', () => {
    const repaired = repairFiduciarySlotOrdering([
      slot({ id: 'seed', contact_id: null, order: 0 }),
      slot({ contact_id: 'A', order: 2 }),
      slot({ contact_id: 'A-co', order: 2, is_co: true }),
    ])
    expect(repaired).toHaveLength(2)
    expect(repaired.find(s => !s.is_co)).toMatchObject({ contact_id: 'A', order: 0 })
    expect(repaired.find(s => s.is_co)).toMatchObject({ contact_id: 'A-co', order: 0 })
  })
})

describe('toggleFiduciaryGridContact on a freshly seeded role', () => {
  const config = ROLE_CONFIG.executor

  it('makes the first appointee 1st, not 2nd', () => {
    const next = toggleFiduciaryGridContact(seeded(), 'A', config)
    expect(namedPrincipalSlots(next)).toHaveLength(1)
    expect(namedPrincipalSlots(next)[0]).toMatchObject({ contact_id: 'A', order: 0 })
  })

  it('appoints successors in click order', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    expect(successionIds(slots)).toEqual(['A', 'B'])
  })

  it('clearing a principal promotes the rest without duplicating anyone', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    slots = toggleFiduciaryGridContact(slots, 'A', config) // clear A
    expect(successionIds(slots)).toEqual(['B'])
    expect(namedPrincipalSlots(slots)[0].order).toBe(0)
    // The old path wrote B onto the empty seed slot while B's own slot kept
    // the id, so B appeared as both 1st and 2nd.
    expect(slots.filter(s => s.contact_id === 'B')).toHaveLength(1)
  })

  it('a role emptied and refilled starts at 1st again', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'A', config) // clear
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    expect(namedPrincipalSlots(slots)[0]).toMatchObject({ contact_id: 'B', order: 0 })
  })

  it('removing a principal drops that line\'s co-agents with it', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'C', config, 0) // co on A's line
    slots = toggleFiduciaryGridContact(slots, 'A', config) // clear A
    expect(slots.filter(s => s.contact_id === 'C')).toHaveLength(0)
  })
})

describe('movePrincipalSlot', () => {
  const config = ROLE_CONFIG.executor

  it('swaps a principal with its neighbor', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    slots = toggleFiduciaryGridContact(slots, 'C', config)
    expect(successionIds(movePrincipalSlot(slots, 'C', -1))).toEqual(['A', 'C', 'B'])
    expect(successionIds(movePrincipalSlot(slots, 'A', 1))).toEqual(['B', 'A', 'C'])
  })

  it('carries co-agents with their principal', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    slots = toggleFiduciaryGridContact(slots, 'A-co', config, 0)
    const moved = movePrincipalSlot(slots, 'A', 1)
    expect(successionIds(moved)).toEqual(['B', 'A'])
    const co = moved.find(s => s.contact_id === 'A-co')
    const a = moved.find(s => s.contact_id === 'A')
    expect(co?.order).toBe(a?.order)
  })

  it('is a no-op at the edges', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    expect(successionIds(movePrincipalSlot(slots, 'A', -1))).toEqual(['A', 'B'])
    expect(successionIds(movePrincipalSlot(slots, 'B', 1))).toEqual(['A', 'B'])
  })
})

describe('removeFiduciaryContact', () => {
  const config = ROLE_CONFIG.executor

  it('removes a principal and compacts the succession', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'B', config)
    slots = toggleFiduciaryGridContact(slots, 'C', config)
    const next = removeFiduciaryContact(slots, 'B')
    expect(successionIds(next)).toEqual(['A', 'C'])
    expect(namedPrincipalSlots(next).map(s => s.order)).toEqual([0, 1])
  })

  it('removes only the co slot for a co-agent', () => {
    let slots = toggleFiduciaryGridContact(seeded(), 'A', config)
    slots = toggleFiduciaryGridContact(slots, 'C', config, 0)
    const next = removeFiduciaryContact(slots, 'C')
    expect(successionIds(next)).toEqual(['A'])
    expect(next.filter(s => s.contact_id === 'C')).toHaveLength(0)
  })
})
