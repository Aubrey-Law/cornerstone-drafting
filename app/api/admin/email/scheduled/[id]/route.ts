import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: Request, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const now = new Date().toISOString()
  const { data, error } = await getAdminClient()
    .from('scheduled_emails')
    .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Pending scheduled email not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

