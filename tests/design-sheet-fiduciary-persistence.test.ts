import { describe, expect, it } from 'vitest'
import {
  buildDesignSheetPersistencePayload,
  inflateDesignSheetRow,
} from '@/lib/designSheetPersistence'
import {
  CLIENT_PRIMARY_CONTACT_ID,
  resolveSlotContactIds,
  SPOUSE_PRIMARY_CONTACT_ID,
} from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-blocks'
import type { FiduciarySlot, MatterContact } from '@/types/database'

const filledExecutorSlots: FiduciarySlot[] = [
  { id: 'executor-1', contact_id: 'contact-abc', is_co: false, order: 0 },
]

describe('fiduciary slot persistence', () => {
  it('strips fiduciary slot arrays from decisions when saving to columns', () => {
    const payload = buildDesignSheetPersistencePayload({
      executor_slots: filledExecutorSlots,
      decisions: {
        executor_slots: [],
        healthcare_provisions: { hipaa_include_poa: true },
      },
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload.executor_slots).toEqual(filledExecutorSlots)
    expect((payload.decisions as Record<string, unknown>).executor_slots).toBeUndefined()
    expect((payload.decisions as Record<string, unknown>).healthcare_provisions).toEqual({
      hipaa_include_poa: true,
    })
  })

  it('prefers decisions fiduciary slots when the column only has empty placeholders', () => {
    const inflated = inflateDesignSheetRow({
      executor_slots: [{ id: 'col-1', contact_id: null, is_co: false, order: 0 }],
      decisions: {
        executor_slots: filledExecutorSlots,
      },
    })

    expect(inflated?.executor_slots).toEqual(filledExecutorSlots)
  })

  it('keeps column fiduciary slots when they carry assignments', () => {
    const inflated = inflateDesignSheetRow({
      executor_slots: filledExecutorSlots,
      decisions: {
        executor_slots: [{ id: 'legacy-1', contact_id: 'other-contact', is_co: false, order: 0 }],
      },
    })

    expect(inflated?.executor_slots).toEqual(filledExecutorSlots)
  })

  it('round-trips assigned fiduciary slots through save payload and inflate', () => {
    const payload = buildDesignSheetPersistencePayload({
      poa_slots: [
        { id: 'poa-1', contact_id: 'contact-poa', is_co: false, order: 0 },
      ],
      decisions: {},
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    const inflated = inflateDesignSheetRow({
      ...payload,
      decisions: payload.decisions,
    })

    expect(inflated?.poa_slots?.[0]?.contact_id).toBe('contact-poa')
  })
})

describe('resolveSlotContactIds', () => {
  const clientContact = {
    id: 'real-client-id',
    first_name: 'Jane',
    last_name: 'Doe',
  } as MatterContact

  const spouseContact = {
    id: 'real-spouse-id',
    first_name: 'John',
    last_name: 'Doe',
  } as MatterContact

  it('rewrites synthetic client shortcut ids to real contact ids', () => {
    const slots: FiduciarySlot[] = [
      { id: 'slot-1', contact_id: CLIENT_PRIMARY_CONTACT_ID, is_co: false, order: 0 },
    ]

    expect(resolveSlotContactIds(slots, clientContact, spouseContact)[0].contact_id).toBe('real-client-id')
  })

  it('rewrites synthetic spouse shortcut ids to real contact ids', () => {
    const slots: FiduciarySlot[] = [
      { id: 'slot-1', contact_id: SPOUSE_PRIMARY_CONTACT_ID, is_co: false, order: 0 },
    ]

    expect(resolveSlotContactIds(slots, clientContact, spouseContact)[0].contact_id).toBe('real-spouse-id')
  })
})
