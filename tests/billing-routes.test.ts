import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))

import { POST as createItem } from '@/app/api/admin/billing/items/route'
import { POST as invoice } from '@/app/api/admin/billing/items/[id]/invoice/route'
import { POST as payment } from '@/app/api/admin/billing/items/[id]/payments/route'
import { POST as reminder } from '@/app/api/admin/billing/items/[id]/reminder/route'
import { POST as dismiss } from '@/app/api/admin/billing/nudges/dismiss/route'

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const context = { params: Promise.resolve({ id: ITEM_ID }) }

describe('billing mutation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ err: null, userId: USER_ID, user: { id: USER_ID } })
    mocks.rpc.mockResolvedValue({ data: { id: ITEM_ID, status: 'invoiced' }, error: null })
    mocks.upsert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ upsert: mocks.upsert })
  })

  it('rejects unauthenticated invoice writes before touching billing data', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })

    const response = await invoice(new Request('http://app.test/api/admin/billing'), context)

    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('forwards the authenticated actor to the atomic invoice RPC', async () => {
    const response = await invoice(new Request('http://app.test/api/admin/billing'), context)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('mark_billing_item_invoiced', {
      p_item_id: ITEM_ID,
      p_actor_id: USER_ID,
    })
  })

  it('validates payment cents and method before invoking the database', async () => {
    const response = await payment(
      new Request('http://app.test/api/admin/billing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 1050.25, method: 'wire' }),
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('records a validated payment with actor and received timestamp', async () => {
    const response = await payment(
      new Request('http://app.test/api/admin/billing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: 125_00,
          method: 'check',
          note: 'Check 1024',
          receivedAt: '2026-07-30T14:00:00.000Z',
        }),
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('record_billing_payment', {
      p_item_id: ITEM_ID,
      p_amount: 125_00,
      p_method: 'check',
      p_note: 'Check 1024',
      p_received_at: '2026-07-30T14:00:00.000Z',
      p_actor_id: USER_ID,
    })
  })

  it('maps an overpayment database rejection to a conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22003', message: 'Payment exceeds open balance' },
    })

    const response = await payment(
      new Request('http://app.test/api/admin/billing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 999_00, method: 'ach' }),
      }),
      context,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Payment exceeds open balance' })
  })

  it('records a reminder through the actor-checked RPC', async () => {
    await reminder(new Request('http://app.test/api/admin/billing'), context)

    expect(mocks.rpc).toHaveBeenCalledWith('mark_billing_reminder_sent', {
      p_item_id: ITEM_ID,
      p_actor_id: USER_ID,
    })
  })

  it('stores only the authenticated user own weekly nudge dismissal', async () => {
    const response = await dismiss(
      new Request('http://app.test/api/admin/billing/nudges/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nudgeKey: `reminder:${ITEM_ID}`,
          weekStart: '2026-07-27',
          userId: '33333333-3333-4333-8333-333333333333',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(
      {
        user_id: USER_ID,
        nudge_key: `reminder:${ITEM_ID}`,
        week_start: '2026-07-27',
      },
      { onConflict: 'user_id,nudge_key,week_start' },
    )
  })

  const MATTER_ID = '33333333-3333-4333-8333-333333333333'

  function createRequest(body: unknown) {
    return new Request('http://app.test/api/admin/billing/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects unauthenticated charge creation before touching billing data', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })

    const response = await createItem(
      createRequest({ matterId: MATTER_ID, kind: 'cost', label: 'Recording fee', amountBilled: 15_500 }),
    )

    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates a hand-added legal fee as a manual item', async () => {
    // source='manual' keeps billing_items_one_engagement_source free for the
    // engagement-seeded fee, so both can coexist on one matter.
    const response = await createItem(
      createRequest({
        matterId: MATTER_ID, kind: 'flat_fee', label: 'Trust package', amountBilled: 480_000,
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('create_billing_item', expect.objectContaining({
      p_kind: 'flat_fee',
      p_plan: null,
      p_amount_billed: 480_000,
    }))
  })

  it('still rejects an unknown charge type', async () => {
    const response = await createItem(
      createRequest({ matterId: MATTER_ID, kind: 'retainer', label: 'Fee', amountBilled: 100 }),
    )

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects fractional and non-positive amounts before invoking the database', async () => {
    for (const amountBilled of [1050.25, 0, -500]) {
      const response = await createItem(
        createRequest({ matterId: MATTER_ID, kind: 'cost', label: 'Recording fee', amountBilled }),
      )
      expect(response.status).toBe(400)
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a plan claim with no plan, and a cost that carries one', async () => {
    const claimWithoutPlan = await createItem(
      createRequest({ matterId: MATTER_ID, kind: 'plan_claim', label: 'Claim', amountBilled: 100 }),
    )
    const costWithPlan = await createItem(
      createRequest({
        matterId: MATTER_ID, kind: 'cost', label: 'Recording fee', amountBilled: 100, plan: 'metlife',
      }),
    )
    const feeWithPlan = await createItem(
      createRequest({
        matterId: MATTER_ID, kind: 'flat_fee', label: 'Trust package', amountBilled: 100, plan: 'metlife',
      }),
    )

    expect(claimWithoutPlan.status).toBe(400)
    expect(costWithPlan.status).toBe(400)
    expect(feeWithPlan.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates a validated cost through the audited RPC with the actor', async () => {
    const response = await createItem(
      createRequest({
        matterId: MATTER_ID, kind: 'cost', label: '  Deed recording fee  ', amountBilled: 15_500,
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('create_billing_item', {
      p_matter_id: MATTER_ID,
      p_kind: 'cost',
      p_label: 'Deed recording fee',
      p_plan: null,
      p_amount_billed: 15_500,
      p_actor_id: USER_ID,
    })
  })

  it('creates a plan claim with its plan', async () => {
    const response = await createItem(
      createRequest({
        matterId: MATTER_ID, kind: 'plan_claim', label: 'MetLife claim',
        amountBilled: 127_500, plan: 'metlife',
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('create_billing_item', expect.objectContaining({
      p_kind: 'plan_claim',
      p_plan: 'metlife',
      p_amount_billed: 127_500,
    }))
  })

  it('maps a database rejection to a conflict rather than a 500', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Only costs and plan claims may be added' },
    })

    const response = await createItem(
      createRequest({ matterId: MATTER_ID, kind: 'cost', label: 'Recording fee', amountBilled: 100 }),
    )

    expect(response.status).toBe(409)
  })
})
