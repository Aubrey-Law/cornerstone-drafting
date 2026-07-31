import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingItemIdSchema } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsedId = billingItemIdSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Invalid billing item id' }, { status: 400 })
  }

  const { data, error } = await getAdminClient().rpc('mark_billing_reminder_sent', {
    p_item_id: parsedId.data,
    p_actor_id: auth.userId,
  })
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ item: data })
}
