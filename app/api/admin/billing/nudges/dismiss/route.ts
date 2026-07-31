import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { dismissBillingNudgeSchema } from '@/lib/billing/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = dismissBillingNudgeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid nudge details are required' }, { status: 400 })
  }

  const { error } = await getAdminClient().from('billing_nudge_dismissals').upsert(
    {
      user_id: auth.userId,
      nudge_key: parsed.data.nudgeKey,
      week_start: parsed.data.weekStart,
    },
    { onConflict: 'user_id,nudge_key,week_start' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
