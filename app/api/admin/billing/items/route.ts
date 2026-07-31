import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createBillingItemSchema } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

function failure(error: { code?: string; message: string }) {
  const status =
    error.code === '42501' ? 403
      : error.code === 'P0002' ? 404
        : error.code === '22023' || error.code === '23514' ? 409
          : 500
  return NextResponse.json({ error: error.message }, { status })
}

/** POST /api/admin/billing/items — add a cost or legal plan claim to a matter. */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createBillingItemSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid charge details are required' }, { status: 400 })
  }

  const { matterId, kind, label, amountBilled, plan } = parsed.data
  const { data, error } = await getAdminClient().rpc('create_billing_item', {
    p_matter_id: matterId,
    p_kind: kind,
    p_label: label,
    p_plan: plan ?? null,
    p_amount_billed: amountBilled,
    p_actor_id: auth.userId,
  })
  if (error) return failure(error)
  return NextResponse.json({ item: data }, { status: 201 })
}
