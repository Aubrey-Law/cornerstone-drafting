import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('sms_messages')
    .update({ read_by_staff_at: new Date().toISOString() })
    .eq('id', id)
    .eq('direction', 'inbound')
    .is('read_by_staff_at', null)
    .select('id, read_by_staff_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Message not found or already read' }, { status: 404 })
  }

  return NextResponse.json({ success: true, smsMessage: data })
}
