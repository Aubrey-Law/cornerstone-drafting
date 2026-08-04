import { describe, expect, it } from 'vitest'
import { buildDraftContext } from '@/lib/drafting/context'

describe('buildDraftContext', () => {
  it('detects co-agents from legacy string columns', () => {
    const ctx = buildDraftContext({
      marital_status: 'married',
      spouse_name: 'Jane Client',
      poa_co: 'Co Agent',
      executor_co: 'Co Executor',
      guardian_co: 'Co Guardian',
    })

    expect(ctx.has_co_poa).toBe(true)
    expect(ctx.has_co_pr).toBe(true)
    expect(ctx.has_co_guardian).toBe(true)
  })

  it('detects co-agents from slot arrays', () => {
    const ctx = buildDraftContext({
      marital_status: 'married',
      spouse_name: 'Jane Client',
      poa_slots: [
        { id: 'poa-1', contact_id: 'contact-1', is_co: false, order: 0 },
        { id: 'poa-2', contact_id: 'contact-2', is_co: true, order: 0 },
      ],
      executor_slots: [
        { id: 'executor-1', contact_id: 'contact-3', is_co: false, order: 0 },
        { id: 'executor-2', contact_id: 'contact-4', is_co: true, order: 0 },
      ],
      guardian_slots: [
        { id: 'guardian-1', contact_id: 'contact-5', is_co: false, order: 0 },
        { id: 'guardian-2', contact_id: 'contact-6', is_co: true, order: 0 },
      ],
    })

    expect(ctx.has_co_poa).toBe(true)
    expect(ctx.has_co_pr).toBe(true)
    expect(ctx.has_co_guardian).toBe(true)
  })

  it('ignores empty co slots without a contact', () => {
    const ctx = buildDraftContext({
      marital_status: 'single',
      poa_slots: [{ id: 'poa-1', contact_id: null, is_co: true, order: 0 }],
      executor_slots: [{ id: 'executor-1', contact_id: null, is_co: true, order: 0 }],
      guardian_slots: [{ id: 'guardian-1', contact_id: null, is_co: true, order: 0 }],
    })

    expect(ctx.has_co_poa).toBe(false)
    expect(ctx.has_co_pr).toBe(false)
    expect(ctx.has_co_guardian).toBe(false)
  })
})

describe('buildDraftContext descendant_representation', () => {
  it('follows the representation type the attorney selected', () => {
    const ctx = buildDraftContext({
      decisions: { trust_details: { representation_type: 'per_capita_each_generation' } },
    })

    expect(ctx.descendant_representation).toBe('per_capita')
  })

  it('maps per stirpes and by-representation to the per stirpes clause', () => {
    for (const representation_type of ['per_stirpes', 'by_representation']) {
      const ctx = buildDraftContext({ decisions: { trust_details: { representation_type } } })
      expect(ctx.descendant_representation).toBe('per_stirpes')
    }
  })

  // The `distribution_method` column holds the residual beneficiary method
  // (outright / staggered / …), not per stirpes vs per capita — reading it here would
  // match neither clause and drop the distribution language entirely.
  it('ignores the same-named column, which means something else', () => {
    const ctx = buildDraftContext({
      distribution_method: 'staggered',
      decisions: { trust_details: { representation_type: 'per_capita_each_generation' } },
    })

    expect(ctx.descendant_representation).toBe('per_capita')
  })

  it('honours a legacy decisions value when no representation type is set', () => {
    const ctx = buildDraftContext({ decisions: { distribution_method: 'per_capita' } })

    expect(ctx.descendant_representation).toBe('per_capita')
  })

  it('defaults to per stirpes when nothing is set', () => {
    expect(buildDraftContext({}).descendant_representation).toBe('per_stirpes')
  })
})
