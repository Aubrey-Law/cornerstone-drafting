import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingItemIdSchema, logBillingPaymentSchema } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

function failure(error: { code?: string; message: string }) {
  const status =
    error.code === '42501' ? 403
      : error.code === 'P0002' ? 404
        : error.code === '22003' || error.code === '22023' ? 409
          : 500
  return NextResponse.json({ error: error.message }, { status })
}

export async function POST(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsedId = billingItemIdSchema.safeParse((await params).id)
  const parsedBody = logBillingPaymentSchema.safeParse(await req.json().catch(() => null))
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ error: 'Valid payment details are required' }, { status: 400 })
  }

  const { amount, method, note, receivedAt } = parsedBody.data
  const { data, error } = await getAdminClient().rpc('record_billing_payment', {
    p_item_id: parsedId.data,
    p_amount: amount,
    p_method: method,
    p_note: note ?? null,
    p_received_at: receivedAt ?? new Date().toISOString(),
    p_actor_id: auth.userId,
  })
  if (error) return failure(error)
  return NextResponse.json({ item: data })
}
