import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createBillingItemsSchema, MAX_CHARGES_PER_BATCH } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

function failure(error: { code?: string; message: string }) {
  const status =
    error.code === '42501' ? 403
      : error.code === 'P0002' ? 404
        : error.code === '22023' || error.code === '23514' ? 409
          : 500
  return NextResponse.json({ error: error.message }, { status })
}

/**
 * POST /api/admin/billing/items/bulk-create — add several charges to one matter.
 *
 * One RPC call, not a loop: create_billing_items runs every line through
 * create_billing_item inside a single transaction, so the set either saves
 * entirely or not at all.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createBillingItemsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Between 1 and ${MAX_CHARGES_PER_BATCH} valid charges are required` },
      { status: 400 },
    )
  }

  const { matterId, charges } = parsed.data
  const { data, error } = await getAdminClient().rpc('create_billing_items', {
    p_matter_id: matterId,
    p_items: charges.map(charge => ({
      kind: charge.kind,
      label: charge.label,
      plan: charge.plan ?? null,
      amount_billed: charge.amountBilled,
    })),
    p_actor_id: auth.userId,
  })
  if (error) return failure(error)
  return NextResponse.json({ items: data ?? [] }, { status: 201 })
}
