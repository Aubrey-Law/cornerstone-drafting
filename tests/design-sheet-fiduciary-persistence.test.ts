import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildDesignSheetPersistencePayload,
  inflateDesignSheetRow,
} from '@/lib/designSheetPersistence'
import {
  CLIENT_PRIMARY_CONTACT_ID,
  primaryContactId,
  resolveSlotContactIds,
  SPOUSE_PRIMARY_CONTACT_ID,
} from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-blocks'
import { setSlotContact, addBackupAgent } from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-helpers'
import type { DesignSheet, FiduciarySlot, MatterContact } from '@/types/database'

const filledExecutorSlots: FiduciarySlot[] = [
  { id: 'executor-1', contact_id: 'contact-abc', is_co: false, order: 0 },
]

describe('fiduciary slot persistence', () => {
  it('round-trips Will, POA, and health care choices stored in decisions', () => {
    const payload = buildDesignSheetPersistencePayload({
      bond: 'required',
      supervision: 'supervised',
      dpoa_include_section_l: 'yes',
      hcp_anatomical_gift: 'none',
      hipaa_psychotherapy_notes: 'do_not_authorize',
      decisions: {},
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    const inflated = inflateDesignSheetRow(payload)

    expect(inflated).toMatchObject({
      bond: 'required',
      supervision: 'supervised',
      dpoa_include_section_l: 'yes',
      hcp_anatomical_gift: 'none',
      hipaa_psychotherapy_notes: 'do_not_authorize',
    })
  })

  it('strips writable column keys from decisions when saving (plan_type, fiduciary slots)', () => {
    const payload = buildDesignSheetPersistencePayload({
      plan_type: 'pour_over',
      executor_slots: filledExecutorSlots,
      decisions: {
        plan_type: 'outright_will',
        executor_slots: [],
        healthcare_provisions: { hipaa_include_poa: true },
      },
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload.plan_type).toBe('pour_over')
    expect(payload.executor_slots).toEqual(filledExecutorSlots)
    const decisions = payload.decisions as Record<string, unknown>
    expect(decisions.plan_type).toBeUndefined()
    expect(decisions.executor_slots).toBeUndefined()
    expect(decisions.healthcare_provisions).toEqual({
      hipaa_include_poa: true,
    })
  })

  it('round-trips plan_type through save payload and inflate without decisions shadow', () => {
    const payload = buildDesignSheetPersistencePayload({
      plan_type: 'testamentary_trust',
      decisions: {
        plan_type: 'pour_over',
        estate_plan_design: { will: true },
      },
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    const inflated = inflateDesignSheetRow({
      ...payload,
      decisions: payload.decisions,
    })

    expect(inflated?.plan_type).toBe('testamentary_trust')
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

describe('functional fiduciary slot updates', () => {
  it('sequential functional updates read the latest sheet state', () => {
    let sheet = {
      executor_slots: [{ id: 'executor-1', contact_id: null, is_co: false, order: 0 }],
    } as Partial<DesignSheet>

    const onChange = <K extends keyof DesignSheet>(
      field: K,
      value: DesignSheet[K] | ((previous: DesignSheet) => DesignSheet[K]),
    ) => {
      const resolved = typeof value === 'function'
        ? value(sheet as DesignSheet)
        : value
      sheet = { ...sheet, [field]: resolved }
    }

    onChange('executor_slots', prev => setSlotContact(prev.executor_slots ?? [], 'executor-1', 'contact-a'))
    onChange('executor_slots', prev => {
      expect(primaryContactId(prev.executor_slots)).toBe('contact-a')
      return setSlotContact(prev.executor_slots ?? [], 'executor-1', 'contact-b')
    })

    expect(primaryContactId(sheet.executor_slots)).toBe('contact-b')
  })

  it('adds backup agents at order 1+ for backup-only sections', () => {
    const empty = addBackupAgent([])
    expect(empty).toHaveLength(1)
    expect(empty[0]?.order).toBe(1)

    const withPrimary = addBackupAgent([
      { id: 'primary', contact_id: 'contact-1', is_co: false, order: 0 },
    ])
    expect(withPrimary.filter(s => !s.is_co).map(s => s.order)).toEqual([0, 1])
  })

  it('uses functional onChange in unified-grid slot persistence', () => {
    const grid = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FiduciaryGrid.tsx'),
      'utf8',
    )

    expect(grid).toContain('onChange(field, previousSheet =>')
    expect(grid).toContain('normalizeFiduciarySlots(updater(resolved))')
    expect(grid).toContain('removeFiduciaryContact')
  })

  it('keeps matter type off design sheet columns and decisions', () => {
    const payload = buildDesignSheetPersistencePayload({
      matter_type: 'couple',
      trust_name: 'The Doe Trust',
      decisions: { matter_type: 'individual', plan_track: 'estate' },
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload).not.toHaveProperty('matter_type')
    expect(payload.decisions).not.toHaveProperty('matter_type')
    expect(payload.decisions).toMatchObject({ plan_track: 'estate' })
    expect(payload.trust_name).toBe('The Doe Trust')

    const inflated = inflateDesignSheetRow({
      trust_name: 'The Doe Trust',
      decisions: { matter_type: 'couple', plan_track: 'estate' },
    })
    expect(inflated?.decisions).not.toHaveProperty('matter_type')
    expect(inflated?.matter_type).toBeUndefined()
  })
})
