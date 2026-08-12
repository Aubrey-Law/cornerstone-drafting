import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingItemIdSchema } from '@/lib/billing/types'
import type { BillingItem } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

function failure(error: { code?: string; message: string }) {
  const status =
    error.code === '42501' ? 403
      : error.code === 'P0002' ? 404
        : error.code === '22023' ? 409
          : 500
  return NextResponse.json({ error: error.message }, { status })
}

/**
 * DELETE /api/admin/billing/items/[id] — remove one charge.
 *
 * Its payments and events cascade away with it; the audited summary survives in
 * billing_item_deletions.
 */
export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsedId = billingItemIdSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Invalid billing item id' }, { status: 400 })
  }

  const { data, error } = await getAdminClient().rpc('delete_billing_items', {
    p_item_ids: [parsedId.data],
    p_actor_id: auth.userId,
  })
  if (error) return failure(error)

  const items = (data ?? []) as Pick<BillingItem, 'id'>[]
  if (items.length === 0) {
    return NextResponse.json({ error: 'Billing item not found' }, { status: 404 })
  }
  return NextResponse.json({ deleted: items.length, items })
}
