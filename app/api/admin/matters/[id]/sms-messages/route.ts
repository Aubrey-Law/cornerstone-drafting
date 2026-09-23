import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(_req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('sms_messages')
    .select(
      'id, direction, recipient_role, recipient_name, body, status, from_number, to_number, created_at, sent_at, actor_name, read_by_staff_at',
    )
    .eq('matter_id', matterId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
