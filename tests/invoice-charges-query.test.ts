import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))

import { fetchInvoiceableCharges } from '@/lib/queries/invoices'

const MATTER = 'matter-1'
const DRAFT = 'invoice-draft'

/** The read chains .select().eq().order(). */
function db(rows: unknown[]) {
  const captured: Record<string, unknown[]> = {}
  mocks.from.mockImplementation(() => {
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => { captured.eq = args; return chain },
      neq: (...args: unknown[]) => { captured.neq = args; return chain },
      order: () => Promise.resolve({ data: rows, error: null }),
    }
    return chain
  })
  return captured
}

function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    kind: 'flat_fee',
    label: 'Flat fee — Trust package',
    amount_billed: 245_000,
    invoice_id: null,
    created_at: '2026-06-01T16:00:00.000Z',
    ...overrides,
  }
}

describe('fetchInvoiceableCharges', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers only unclaimed charges', async () => {
    const captured = db([
      charge(),
      charge({ id: 'item-2', invoice_id: 'some-other-invoice' }),
    ])

    const charges = await fetchInvoiceableCharges(MATTER)

    expect(charges.map(row => row.id)).toEqual(['item-1'])
    expect(captured.eq).toEqual(['matter_id', MATTER])
    expect(captured.neq).toBeUndefined()
  })

  it('offers plan claims with their carrier, for an invoice billed to the plan', async () => {
    db([
      charge(),
      charge({ id: 'claim-1', kind: 'plan_claim', plan: 'metlife', label: 'CT 220 — Power of Attorney' }),
    ])

    const charges = await fetchInvoiceableCharges(MATTER)

    expect(charges.map(row => [row.id, row.plan])).toEqual([['item-1', null], ['claim-1', 'metlife']])
  })

  it('does not offer a claim the carrier has already paid off-invoice', async () => {
    db([
      charge({ id: 'claim-paid', kind: 'plan_claim', plan: 'metlife', status: 'paid' }),
      charge({ id: 'claim-open', kind: 'plan_claim', plan: 'metlife', status: 'invoiced' }),
    ])

    expect((await fetchInvoiceableCharges(MATTER)).map(row => row.id)).toEqual(['claim-open'])
  })

  it('also offers the charges the draft being edited already holds', async () => {
    db([
      charge(),
      charge({ id: 'item-2', invoice_id: DRAFT }),
      charge({ id: 'item-3', invoice_id: 'another-invoice' }),
    ])

    const charges = await fetchInvoiceableCharges(MATTER, DRAFT)

    // Without item-2 the editor would hide the very lines it exists to change.
    expect(charges.map(row => row.id)).toEqual(['item-1', 'item-2'])
  })

  it('maps cents through untouched', async () => {
    db([charge({ amount_billed: 45_000 })])

    expect((await fetchInvoiceableCharges(MATTER))[0]).toEqual({
      id: 'item-1',
      kind: 'flat_fee',
      plan: null,
      label: 'Flat fee — Trust package',
      amountBilled: 45_000,
      createdAt: '2026-06-01T16:00:00.000Z',
    })
  })
})
