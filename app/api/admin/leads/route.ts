import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'

/**
 * POST /api/admin/leads — create a lead: a standalone client_intake row with
 * no matter. The matter is created later (automatically when the engagement
 * agreement is signed, or manually from the Leads page).
 */
export async function POST(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as {
    clientName?: string
    clientEmail?: string
    clientPhone?: string
    practiceArea?: string
    feeQuoted?: number | null
  }
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
  const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim().toLowerCase() : ''
  if (!clientName || !clientEmail) {
    return NextResponse.json({ error: 'clientName and clientEmail are required' }, { status: 400 })
  }
  const feeQuoted =
    typeof body.feeQuoted === 'number' && Number.isFinite(body.feeQuoted) ? body.feeQuoted : null

  const nameParts = clientName.split(/\s+/)
  const admin = getAdminClient()
  const { data: lead, error } = await admin
    .from('client_intake')
    .insert({
      email: clientEmail,
      first_name: nameParts[0] ?? clientName,
      last_name: nameParts.slice(1).join(' ') || null,
      full_name: clientName,
      phone: typeof body.clientPhone === 'string' ? body.clientPhone.trim() || null : null,
      practice_area: normalizePracticeArea(body.practiceArea),
      status: 'in_progress',
      lead_status: 'lead',
      engagement_fee_quoted: feeQuoted,
    })
    .select('id')
    .single()
  if (error || !lead) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create lead' }, { status: 500 })
  }

  return NextResponse.json({ leadId: lead.id })
}
