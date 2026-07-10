import { describe, expect, it, vi } from 'vitest'
import {
  addCo,
  normalizeFiduciarySlots,
  removeCo,
  setSlotContact,
  slotsByOrder,
} from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-helpers'
import type { FiduciarySlot } from '@/types/database'

vi.stubGlobal('crypto', {
  randomUUID: vi.fn()
    .mockReturnValueOnce('co-1')
    .mockReturnValueOnce('co-2')
    .mockReturnValueOnce('co-3')
    .mockReturnValueOnce('co-4')
    .mockReturnValueOnce('fixed-dup-id')
    .mockReturnValueOnce('promoted-order'),
})

describe('design sheet fiduciary co-agent slots', () => {
  it('allows up to three co-agents at the same fiduciary priority', () => {
    const slots: FiduciarySlot[] = [{ id: 'primary', contact_id: null, is_co: false, order: 0 }]

    const one = addCo(slots, 0)
    const two = addCo(one, 0)
    const three = addCo(two, 0)
    const capped = addCo(three, 0)

    expect(three.filter(slot => slot.order === 0 && slot.is_co)).toHaveLength(3)
    expect(capped).toHaveLength(4)
    expect(slotsByOrder(three)[0].coSlots.map(slot => slot.id)).toEqual(['co-1', 'co-2', 'co-3'])
  })

  it('removes one co-agent without clearing the full priority group', () => {
    const slots: FiduciarySlot[] = [
      { id: 'primary', contact_id: null, is_co: false, order: 0 },
      { id: 'co-1', contact_id: 'a', is_co: true, order: 0 },
      { id: 'co-2', contact_id: 'b', is_co: true, order: 0 },
    ]

    expect(removeCo(slots, 'co-1')).toEqual([
      { id: 'primary', contact_id: null, is_co: false, order: 0 },
      { id: 'co-2', contact_id: 'b', is_co: true, order: 0 },
    ])
  })
})

describe('normalizeFiduciarySlots / setSlotContact', () => {
  it('collapses duplicate principal slots at the same order so one pick cannot yield two names', () => {
    const slots: FiduciarySlot[] = [
      { id: 'primary', contact_id: null, is_co: false, order: 0 },
      { id: 'alt-a', contact_id: 'person-a', is_co: false, order: 1 },
      { id: 'alt-b', contact_id: 'person-b', is_co: false, order: 1 },
    ]

    const normalized = normalizeFiduciarySlots(slots)
    expect(normalized.filter(s => !s.is_co && s.order === 1)).toHaveLength(1)
    expect(normalized.find(s => s.id === 'alt-a')?.contact_id).toBe('person-a')
    // Filled duplicate is promoted to the next free order instead of silently dropped.
    expect(normalized.find(s => s.contact_id === 'person-b')?.order).toBe(2)
  })

  it('rewrites duplicate slot ids so setSlotContact only updates one slot', () => {
    const slots: FiduciarySlot[] = [
      { id: 'shared', contact_id: null, is_co: false, order: 0 },
      { id: 'shared', contact_id: null, is_co: false, order: 1 },
    ]

    const next = setSlotContact(slots, 'shared', 'only-one')
    const filled = next.filter(s => s.contact_id === 'only-one')
    expect(filled).toHaveLength(1)
    expect(new Set(next.map(s => s.id)).size).toBe(next.length)
  })
})
