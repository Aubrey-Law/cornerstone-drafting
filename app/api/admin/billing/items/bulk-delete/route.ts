import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { deleteBillingItemsSchema } from '@/lib/billing/types'
import type { BillingItem } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

function failure(error: { code?: string; message: string }) {
  const status =
    error.code === '42501' ? 403
      : error.code === 'P0002' ? 404
        : error.code === '22023' ? 409
          : 500
  return NextResponse.json({ error: error.message }, { status })
}

/**
 * POST /api/admin/billing/items/bulk-delete — remove several charges at once.
 *
 * One RPC call, not a loop: the delete is a single statement so a selection
 * either goes entirely or not at all. Ids that no longer exist are simply not
 * returned, and the response reports the difference.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = deleteBillingItemsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Between 1 and 100 billing item ids are required' },
      { status: 400 },
    )
  }

  const requested = [...new Set(parsed.data.ids)]
  const { data, error } = await getAdminClient().rpc('delete_billing_items', {
    p_item_ids: requested,
    p_actor_id: auth.userId,
  })
  if (error) return failure(error)

  const items = (data ?? []) as Pick<BillingItem, 'id'>[]
  return NextResponse.json({
    ok: items.length === requested.length,
    deleted: items.length,
    requested: requested.length,
    items,
  })
}
