import { describe, expect, it } from 'vitest'
import { reconcileFieldValues } from '@/lib/fieldConsistency/reconcile'

describe('field consistency reconciliation', () => {
  it('reports only unexplained differences by default', () => {
    const rows = reconcileFieldValues({
      matterId: 'matter-1',
      sources: {
        client_name: 'Alex Example',
        street: '1 Main Street',
        client_citizenship: 'Non-US — status unconfirmed',
      },
      design: {
        client_name: 'Alex Example',
        street: '2 Main Street',
        client_citizenship: 'Permanent Resident',
      },
      overrides: {
        client_citizenship: { original: 'Non-US — status unconfirmed' },
      },
    })

    expect(rows).toEqual([{
      matterId: 'matter-1',
      field: 'street',
      sourceValue: '1 Main Street',
      designValue: '2 Main Street',
      hasOverride: false,
    }])
  })

  it('can include attorney-overridden differences for a complete audit', () => {
    const rows = reconcileFieldValues({
      matterId: 'matter-2',
      sources: { client_citizenship: 'Non-US — status unconfirmed' },
      design: { client_citizenship: 'Permanent Resident' },
      overrides: { client_citizenship: { original: 'Non-US — status unconfirmed' } },
      includeOverrides: true,
    })

    expect(rows[0]?.hasOverride).toBe(true)
  })
})
