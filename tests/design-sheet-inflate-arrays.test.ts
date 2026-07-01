import { describe, expect, it } from 'vitest'

import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'

describe('inflateDesignSheetRow array coercion', () => {
  it('coerces a malformed object value for array fields into an empty array', () => {
    // Some legacy rows stored `{}` (the jsonb default) instead of `[]`, which
    // crashed callers that use array methods (design-sheet readiness).
    const sheet = inflateDesignSheetRow({
      id: 'ds-1',
      matter_id: 'm-1',
      assets: {},
      children: {},
      trustee_slots: {},
      decisions: {},
    })

    expect(Array.isArray(sheet?.assets)).toBe(true)
    expect(sheet?.assets).toHaveLength(0)
    expect(Array.isArray(sheet?.children)).toBe(true)
    expect(Array.isArray(sheet?.trustee_slots)).toBe(true)
  })

  it('preserves real arrays and leaves null untouched', () => {
    const sheet = inflateDesignSheetRow({
      id: 'ds-2',
      matter_id: 'm-2',
      assets: [{ description: 'House', estimated_value: 500000 }],
      children: null,
      decisions: {},
    })

    expect(sheet?.assets).toHaveLength(1)
    expect(sheet?.children).toBeNull()
  })
})
