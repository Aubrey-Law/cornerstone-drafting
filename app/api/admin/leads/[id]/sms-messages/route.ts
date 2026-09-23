import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: leadId } = await params
  const admin = getAdminClient()

  // Inbound replies are auto-linked by phone match; older or edge-case rows
  // may only carry the lead's opportunity matter, so include that thread too.
  const { data: lead } = await admin
    .from('client_intake')
    .select('matter_id')
    .eq('id', leadId)
    .maybeSingle()

  let query = admin
    .from('sms_messages')
    .select(
      'id, direction, recipient_role, recipient_name, body, status, from_number, to_number, created_at, sent_at, actor_name, read_by_staff_at',
    )
    .is('deleted_at', null)
  query = lead?.matter_id
    ? query.or(`lead_id.eq.${leadId},matter_id.eq.${lead.matter_id}`)
    : query.eq('lead_id', leadId)
  const { data, error } = await query.order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
