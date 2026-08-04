import { describe, expect, it } from 'vitest'
import { buildDraftContext } from '@/lib/drafting/context'
import { documentsNeedingDescendantRepresentation, getClausesForDocument } from '@/lib/drafting/clauses'

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

  it('maps per stirpes to the per stirpes clause', () => {
    const ctx = buildDraftContext({ decisions: { trust_details: { representation_type: 'per_stirpes' } } })

    expect(ctx.descendant_representation).toBe('per_stirpes')
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

// Regression: "by right of representation" is a third, distinct option in Trust
// Details with no clause of its own, and which of the other two it equates to is
// jurisdiction-dependent (MA UPC G.L. c. 190B § 2-106 makes it per capita at each
// generation; elsewhere it tracks per stirpes). It used to collapse into per
// stirpes, silently changing who inherits.
describe('by right of representation', () => {
  const byRepresentation = { decisions: { trust_details: { representation_type: 'by_representation' } } }

  it('resolves to null rather than picking a side', () => {
    expect(buildDraftContext(byRepresentation).descendant_representation).toBeNull()
  })

  it('selects neither distribution clause', () => {
    const ctx = buildDraftContext(byRepresentation)
    const ids = getClausesForDocument('joint_revocable_trust', ctx).map(clause => clause.id)

    expect(ids).not.toContain('jt_distribution_per_stirpes')
    expect(ids).not.toContain('jt_distribution_per_capita')
  })

  // Which is why the drafting route has to refuse: without the guard the document
  // would simply be assembled with no descendant-distribution provision.
  it('names the documents that must not be drafted without it', () => {
    expect([...documentsNeedingDescendantRepresentation()]).toEqual(['joint_revocable_trust'])
  })

  it('still resolves the two representations the library covers', () => {
    for (const [representation_type, expected] of [
      ['per_stirpes', 'per_stirpes'],
      ['per_capita_each_generation', 'per_capita'],
    ] as const) {
      const ctx = buildDraftContext({ decisions: { trust_details: { representation_type } } })
      expect(ctx.descendant_representation).toBe(expected)
    }
  })
})
