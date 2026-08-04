import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: leadId } = await params
  const limitRaw = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50
  const admin = getAdminClient()

  // `calls_autoassign` used to put lead calls on the lead's opportunity matter
  // (its lead branch was unreachable after the leads/matters unification), so
  // history recorded before that fix only carries matter_id. Mirrors what
  // sms-messages already does.
  const { data: lead } = await admin
    .from('client_intake')
    .select('matter_id')
    .eq('id', leadId)
    .maybeSingle()

  let query = admin
    .from('calls')
    .select(
      'id, direction, status, participant_number, started_at, duration_seconds, recording_url, voicemail_url, summary, firm_user_email',
    )
  query = lead?.matter_id
    ? query.or(`lead_id.eq.${leadId},matter_id.eq.${lead.matter_id}`)
    : query.eq('lead_id', leadId)

  const { data, error } = await query
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
