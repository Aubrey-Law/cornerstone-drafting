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
import { DELETE as deleteItem, PATCH as updateItem } from '@/app/api/admin/billing/items/[id]/route'
import { POST as bulkDelete } from '@/app/api/admin/billing/items/bulk-delete/route'
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

  const SECOND_ITEM_ID = '44444444-4444-4444-8444-444444444444'

  function bulkDeleteRequest(body: unknown) {
    return new Request('http://app.test/api/admin/billing/items/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects an unauthenticated deletion before touching billing data', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })

    const single = await deleteItem(new Request('http://app.test/api/admin/billing'), context)
    const bulk = await bulkDelete(bulkDeleteRequest({ ids: [ITEM_ID] }))

    expect(single.status).toBe(401)
    expect(bulk.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('deletes one charge through the audited RPC with the actor', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: ITEM_ID }], error: null })

    const response = await deleteItem(new Request('http://app.test/api/admin/billing'), context)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('delete_billing_items', {
      p_item_ids: [ITEM_ID],
      p_actor_id: USER_ID,
    })
    await expect(response.json()).resolves.toEqual({ deleted: 1, items: [{ id: ITEM_ID }] })
  })

  it('reports a charge that no longer exists as gone, not as a success', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })

    const response = await deleteItem(new Request('http://app.test/api/admin/billing'), context)

    expect(response.status).toBe(404)
  })

  it('maps a non-staff deletion to a forbidden response', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Attorney or admin access required' },
    })

    const response = await deleteItem(new Request('http://app.test/api/admin/billing'), context)

    expect(response.status).toBe(403)
  })

  it('rejects an empty, oversized or malformed bulk selection', async () => {
    const empty = await bulkDelete(bulkDeleteRequest({ ids: [] }))
    const notIds = await bulkDelete(bulkDeleteRequest({ ids: ['not-a-uuid'] }))
    const tooMany = await bulkDelete(
      bulkDeleteRequest({ ids: Array.from({ length: 101 }, () => ITEM_ID) }),
    )

    expect(empty.status).toBe(400)
    expect(notIds.status).toBe(400)
    expect(tooMany.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('deletes a whole selection in one call, deduplicating the ids', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: ITEM_ID }, { id: SECOND_ITEM_ID }],
      error: null,
    })

    const response = await bulkDelete(
      bulkDeleteRequest({ ids: [ITEM_ID, SECOND_ITEM_ID, ITEM_ID] }),
    )

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('delete_billing_items', {
      p_item_ids: [ITEM_ID, SECOND_ITEM_ID],
      p_actor_id: USER_ID,
    })
    await expect(response.json()).resolves.toMatchObject({ ok: true, deleted: 2, requested: 2 })
  })

  it('flags a partial bulk delete rather than claiming every id was removed', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: ITEM_ID }], error: null })

    const response = await bulkDelete(bulkDeleteRequest({ ids: [ITEM_ID, SECOND_ITEM_ID] }))

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      deleted: 1,
      requested: 2,
    })
  })
  function patchRequest(body: unknown) {
    return new Request('http://app.test/api/admin/billing/items/id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects an unauthenticated edit before touching billing data', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })

    const response = await updateItem(
      patchRequest({ kind: 'cost', label: 'Recording fee', amountBilled: 15_500 }),
      context,
    )

    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('edits a charge through the audited RPC with the actor', async () => {
    const response = await updateItem(
      patchRequest({ kind: 'cost', label: '  Deed recording fee  ', amountBilled: 15_500 }),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('update_billing_item', {
      p_item_id: ITEM_ID,
      p_kind: 'cost',
      p_label: 'Deed recording fee',
      p_plan: null,
      p_amount_billed: 15_500,
      p_actor_id: USER_ID,
    })
  })

  it('carries the plan when a charge is edited into a plan claim', async () => {
    const response = await updateItem(
      patchRequest({
        kind: 'plan_claim', label: 'MetLife claim', amountBilled: 127_500, plan: 'legalease',
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('update_billing_item', expect.objectContaining({
      p_kind: 'plan_claim',
      p_plan: 'legalease',
    }))
  })

  it('applies the same field rules to an edit as to a new charge', async () => {
    const noLabel = await updateItem(patchRequest({ kind: 'cost', label: '   ', amountBilled: 100 }), context)
    const fractional = await updateItem(patchRequest({ kind: 'cost', label: 'Fee', amountBilled: 10.5 }), context)
    const claimNoPlan = await updateItem(patchRequest({ kind: 'plan_claim', label: 'Claim', amountBilled: 100 }), context)
    const costWithPlan = await updateItem(
      patchRequest({ kind: 'cost', label: 'Fee', amountBilled: 100, plan: 'metlife' }),
      context,
    )
    const unknownKind = await updateItem(patchRequest({ kind: 'retainer', label: 'Fee', amountBilled: 100 }), context)

    for (const response of [noLabel, fractional, claimNoPlan, costWithPlan, unknownKind]) {
      expect(response.status).toBe(400)
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('maps an amount below what was collected to a conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22003', message: 'Amount is below the 1500.00 already collected' },
    })

    const response = await updateItem(
      patchRequest({ kind: 'flat_fee', label: 'Trust package', amountBilled: 100_000 }),
      context,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Amount is below the 1500.00 already collected',
    })
  })

  it('reports an edit to a charge that no longer exists as gone', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'Billing item not found' },
    })

    const response = await updateItem(
      patchRequest({ kind: 'cost', label: 'Recording fee', amountBilled: 100 }),
      context,
    )

    expect(response.status).toBe(404)
  })
})
