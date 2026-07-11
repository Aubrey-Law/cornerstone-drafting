import { describe, expect, it } from 'vitest'
import {
  applyAttorneyPreset,
  buildAttorneyPreset,
  buildCopyClientToSpousePatch,
  buildTrusteesToPrimaryRolesPatch,
  orderFastEntrySections,
  preserveFastEntrySectionOrder,
  previewAttorneyPreset,
  type AttorneyDesignPreset,
} from '@/lib/designSheet/fastEntryWorkflow'
import type { DesignSheet } from '@/types/database'

const sheet = (values: Partial<DesignSheet> = {}) => values as DesignSheet

describe('fast-entry workflow helpers', () => {
  it('orders attention and incomplete sections before completed sections', () => {
    const sections = [{ id: 'client' }, { id: 'plan' }, { id: 'notes' }, { id: 'trust' }]
    const summaries = {
      client: { status: 'complete' as const, detail: null },
      plan: { status: 'attention' as const, detail: null },
      notes: { status: 'none' as const, detail: null },
      trust: { status: 'override' as const, detail: null },
    }

    expect(orderFastEntrySections(sections, summaries).map(section => section.id))
      .toEqual(['plan', 'notes', 'trust', 'client'])
  })

  it('preserves the rendered section order when completion statuses change', () => {
    const sections = [{ id: 'client' }, { id: 'plan' }, { id: 'trust' }]
    const initial = preserveFastEntrySectionOrder(sections, {
      client: { status: 'attention', detail: null },
      plan: { status: 'none', detail: null },
      trust: { status: 'complete', detail: null },
    }, [])

    const afterSelection = preserveFastEntrySectionOrder(sections, {
      client: { status: 'complete', detail: null },
      plan: { status: 'attention', detail: null },
      trust: { status: 'complete', detail: null },
    }, initial.map(section => section.id))

    expect(afterSelection.map(section => section.id)).toEqual(['client', 'plan', 'trust'])
  })

  it('builds a versioned preset from allowlisted fields only', () => {
    const preset = buildAttorneyPreset(sheet({
      bond: 'no_bond',
      supervision: 'unsupervised',
      client_name: 'Never Copy Me',
      hipaa_psychotherapy_notes: 'authorize',
    }))

    expect(preset).toEqual({
      version: 1,
      fields: { bond: 'no_bond', supervision: 'unsupervised' },
    })
  })

  it('previews and applies presets non-destructively by default', () => {
    const preset: AttorneyDesignPreset = {
      version: 1 as const,
      fields: { bond: 'no_bond', supervision: 'unsupervised', utma_age: 21 },
    }
    const current = sheet({ bond: 'required', supervision: null, utma_age: null })

    expect(previewAttorneyPreset(current, preset)).toEqual([
      { field: 'bond', currentValue: 'required', presetValue: 'no_bond', conflict: true },
      { field: 'supervision', currentValue: null, presetValue: 'unsupervised', conflict: false },
      { field: 'utma_age', currentValue: null, presetValue: 21, conflict: false },
    ])
    expect(applyAttorneyPreset(current, preset)).toEqual({ supervision: 'unsupervised', utma_age: 21 })
    expect(applyAttorneyPreset(current, preset, { overwrite: true })).toEqual(preset.fields)
  })

  it('makes the client the spouse primary and copies only client backups', () => {
    const trusteeSlots = [
      { id: 't1', order: 0, contact_id: 'trustee-primary', is_co: false },
      { id: 't2', order: 1, contact_id: 'trustee-backup', is_co: true },
    ]
    const executorSlots = [
      { id: 'e1', order: 0, contact_id: 'executor-primary', is_co: false },
      { id: 'e2', order: 1, contact_id: 'executor-backup', is_co: false },
    ]
    const poaSlots = [
      { id: 'p1', order: 0, contact_id: 'poa-primary', is_co: false },
      { id: 'p2', order: 1, contact_id: 'poa-backup', is_co: false },
    ]
    const hcpSlots = [
      { id: 'h1', order: 0, contact_id: 'hcp-primary', is_co: false },
      { id: 'h2', order: 1, contact_id: 'hcp-backup', is_co: false },
    ]
    const current = sheet({
      trustee_slots: trusteeSlots,
      executor_slots: executorSlots,
      poa_slots: poaSlots,
      hcp_slots: hcpSlots,
      decisions: {
        healthcare_provisions: {
          client_anatomical_gift: 'yes',
          client_advance_directive: 'do_not_prolong_life',
        },
      },
    })

    const patch = buildCopyClientToSpousePatch(current)
    expect(patch.spouse_trustee_slots).toEqual([
      { id: 't1', order: 0, contact_id: '__design_sheet_client__', is_co: false },
      { id: 't2', order: 1, contact_id: 'trustee-backup', is_co: true },
    ])
    expect(patch.spouse_executor_slots?.map(slot => slot.contact_id))
      .toEqual(['__design_sheet_client__', 'executor-backup'])
    expect(patch.spouse_poa_slots?.map(slot => slot.contact_id))
      .toEqual(['__design_sheet_client__', 'poa-backup'])
    expect(patch.spouse_hcp_slots?.map(slot => slot.contact_id))
      .toEqual(['__design_sheet_client__', 'hcp-backup'])
    expect(patch.spouse_trustee_slots).not.toBe(trusteeSlots)
    expect(patch.spouse_trustee_slots?.[1]).not.toBe(trusteeSlots[1])
    expect(trusteeSlots[0].contact_id).toBe('trustee-primary')
    expect(patch.decisions).toMatchObject({
      healthcare_provisions: {
        client_anatomical_gift: 'yes',
        spouse_anatomical_gift: 'yes',
        client_advance_directive: 'do_not_prolong_life',
        spouse_advance_directive: 'do_not_prolong_life',
      },
    })
  })

  it('uses the client as the sole spouse primary when the client role is empty', () => {
    const patch = buildCopyClientToSpousePatch(sheet({
      trustee_slots: [],
      executor_slots: [],
      poa_slots: [],
      hcp_slots: [],
    }))

    for (const slots of [
      patch.spouse_trustee_slots,
      patch.spouse_executor_slots,
      patch.spouse_poa_slots,
      patch.spouse_hcp_slots,
    ]) {
      expect(slots).toHaveLength(1)
      expect(slots?.[0]).toMatchObject({
        contact_id: '__design_sheet_client__',
        is_co: false,
        order: 0,
      })
    }
  })

  it('copies trustee ordering into applicable client primary roles', () => {
    const trusteeSlots = [
      { id: 't1', order: 0, contact_id: 'trustee-1', is_co: false },
      { id: 't2', order: 1, contact_id: 'trustee-2', is_co: false },
    ]
    const patch = buildTrusteesToPrimaryRolesPatch(sheet({ trustee_slots: trusteeSlots }), {
      will: true,
      dpoa: true,
      healthcare: false,
    })

    expect(patch).toMatchObject({ executor_slots: trusteeSlots, poa_slots: trusteeSlots })
    expect(patch.hcp_slots).toBeUndefined()
  })
})
