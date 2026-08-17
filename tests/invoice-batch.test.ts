import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planBatchInvoices } from '@/lib/billing/invoices'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    matterId: 'matter-1',
    clientName: 'Chen, Marcus',
    matterNumber: '2026-EP-Chen-014',
    kind: 'flat_fee',
    amountBilled: 200_000,
    balance: 200_000,
    invoiceId: null,
    ...overrides,
  }
}

describe('planBatchInvoices', () => {
  it('makes one invoice per matter, not one per charge', () => {
    const { groups } = planBatchInvoices([
      row({ id: 'a', matterId: 'm1', clientName: 'Chen', amountBilled: 200_000, balance: 200_000 }),
      row({ id: 'b', matterId: 'm1', clientName: 'Chen', kind: 'cost', amountBilled: 45_000, balance: 45_000 }),
      row({ id: 'c', matterId: 'm2', clientName: 'Alvarez', amountBilled: 100_000, balance: 100_000 }),
    ])

    expect(groups).toHaveLength(2)
    // Sorted by client so the preview reads predictably.
    expect(groups[0].clientName).toBe('Alvarez')
    expect(groups[1].chargeCount).toBe(2)
    expect(groups[1].subtotalCents).toBe(245_000)
    expect(groups[1].itemIds).toEqual(['a', 'b'])
  })

  it('keeps a plan claim off a client invoice and says why', () => {
    const { groups, skipped } = planBatchInvoices([
      row({ id: 'a' }),
      row({ id: 'b', kind: 'plan_claim' }),
    ])

    expect(groups[0].itemIds).toEqual(['a'])
    expect(skipped).toEqual([{
      matterId: 'matter-1',
      clientName: 'Chen, Marcus',
      reason: 'Legal plan claims are billed to the carrier',
    }])
  })

  it('skips a charge already on an invoice', () => {
    const { groups, skipped } = planBatchInvoices([row({ invoiceId: 'inv-1' })])
    expect(groups).toHaveLength(0)
    expect(skipped[0].reason).toBe('Already on an invoice')
  })

  it('skips a charge with nothing left to bill', () => {
    const { groups, skipped } = planBatchInvoices([row({ balance: 0 })])
    expect(groups).toHaveLength(0)
    expect(skipped[0].reason).toBe('Nothing left to bill')
  })

  it('reports each reason once per matter rather than once per charge', () => {
    const { skipped } = planBatchInvoices([
      row({ id: 'a', kind: 'plan_claim' }),
      row({ id: 'b', kind: 'plan_claim' }),
      row({ id: 'c', kind: 'plan_claim' }),
    ])
    expect(skipped).toHaveLength(1)
  })

  it('returns nothing for an empty selection', () => {
    expect(planBatchInvoices([])).toEqual({ groups: [], skipped: [] })
  })
})

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))

import { POST as batch } from '@/app/api/admin/billing/invoices/batch/route'

const USER_ID = '22222222-2222-4222-8222-222222222222'
const A = '11111111-1111-4111-8111-111111111111'
const B = '33333333-3333-4333-8333-333333333333'

/** Minimal Supabase query-builder stand-in for the three reads the route makes. */
function table(name: string) {
  const rows: Record<string, unknown[]> = {
    billing_items: [
      { id: A, matter_id: 'm1', kind: 'flat_fee', amount_billed: 200_000, invoice_id: null },
      { id: B, matter_id: 'm2', kind: 'flat_fee', amount_billed: 100_000, invoice_id: null },
    ],
    billing_payments: [],
    v_matter_pipeline: [
      { matter_id: 'm1', client_name: 'Chen', matter_name: null },
      { matter_id: 'm2', client_name: 'Alvarez', matter_name: null },
    ],
  }
  return { select: () => ({ in: () => Promise.resolve({ data: rows[name] ?? [], error: null }) }) }
}

function post(body: unknown) {
  return new Request('http://app.test/api/admin/billing/invoices/batch', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('batch invoicing route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ err: null, userId: USER_ID, user: { id: USER_ID } })
    mocks.from.mockImplementation(table)
    mocks.rpc.mockResolvedValue({ data: { id: 'inv-new', subtotal_cents: 200_000 }, error: null })
  })

  it('rejects an unauthenticated batch before reading anything', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })
    const response = await batch(post({ itemIds: [A], issueDate: '2026-08-17' }))
    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates one draft per matter', async () => {
    const response = await batch(post({ itemIds: [A, B], issueDate: '2026-08-17', dueInDays: 30 }))

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    const matters = mocks.rpc.mock.calls.map(call => call[1].p_matter_id).sort()
    expect(matters).toEqual(['m1', 'm2'])
    // Net 30 from the issue date.
    expect(mocks.rpc.mock.calls[0][1].p_due_date).toBe('2026-09-16')
    expect(mocks.rpc.mock.calls[0][1].p_actor_id).toBe(USER_ID)
  })

  it('reports a rejected group instead of losing the whole batch', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'Charge already invoiced' } })
      .mockResolvedValueOnce({ data: { id: 'inv-2', subtotal_cents: 100_000 }, error: null })

    const response = await batch(post({ itemIds: [A, B], issueDate: '2026-08-17' }))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.created).toHaveLength(1)
    expect(json.skipped).toEqual([
      expect.objectContaining({ reason: 'Charge already invoiced' }),
    ])
  })

  it('refuses a malformed issue date', async () => {
    const response = await batch(post({ itemIds: [A], issueDate: '17/08/2026' }))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses an empty selection', async () => {
    expect((await batch(post({ itemIds: [], issueDate: '2026-08-17' }))).status).toBe(400)
  })

  it('404s when none of the charges exist', async () => {
    mocks.from.mockImplementation(() => ({
      select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
    }))
    expect((await batch(post({ itemIds: [A], issueDate: '2026-08-17' }))).status).toBe(404)
  })
})
