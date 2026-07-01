import { describe, expect, it, vi } from 'vitest'
import { addCo, removeCo, slotsByOrder } from '@/app/admin/matters/[id]/design/sections/fiduciary-helpers'
import type { FiduciarySlot } from '@/types/database'

vi.stubGlobal('crypto', {
  randomUUID: vi.fn()
    .mockReturnValueOnce('co-1')
    .mockReturnValueOnce('co-2')
    .mockReturnValueOnce('co-3')
    .mockReturnValueOnce('co-4'),
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
