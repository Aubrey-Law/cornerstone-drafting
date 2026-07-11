import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { deleteLead } from '@/lib/leads/deleteLead'

/**
 * PATCH /api/admin/leads/[id] — edit a lead (standalone client_intake row).
 * DELETE — delete a lead (guards converted leads; cleans up the envelope + R2).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: intakeId } = await params
  const body = (await req.json().catch(() => ({}))) as {
    clientName?: string
    clientEmail?: string
    clientPhone?: string
    practiceArea?: string
    feeQuoted?: number | null
    leadStatus?: string
  }

  const admin = getAdminClient()
  const { data: lead } = await admin
    .from('client_intake')
    .select('id, matter_id')
    .eq('id', intakeId)
    .maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (lead.matter_id) {
    return NextResponse.json(
      { error: 'Lead already converted — edit it from the matter page.' },
      { status: 409 },
    )
  }

  const update: Record<string, unknown> = {}
  if (typeof body.clientName === 'string' && body.clientName.trim()) {
    const clientName = body.clientName.trim()
    const parts = clientName.split(/\s+/)
    update.full_name = clientName
    update.first_name = parts[0] ?? clientName
    update.last_name = parts.slice(1).join(' ') || null
  }
  if (typeof body.clientEmail === 'string' && body.clientEmail.trim()) {
    update.email = body.clientEmail.trim().toLowerCase()
  }
  if (typeof body.clientPhone === 'string') {
    update.phone = body.clientPhone.trim() || null
  }
  if (typeof body.practiceArea === 'string' && body.practiceArea.trim()) {
    update.practice_area = normalizePracticeArea(body.practiceArea)
  }
  if (body.feeQuoted !== undefined) {
    update.engagement_fee_quoted =
      typeof body.feeQuoted === 'number' && Number.isFinite(body.feeQuoted) ? body.feeQuoted : null
  }
  if (body.leadStatus !== undefined) {
    if (!['lead', 'hired', 'lost'].includes(body.leadStatus)) {
      return NextResponse.json({ error: 'Invalid lead status' }, { status: 400 })
    }
    update.lead_status = body.leadStatus
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: row, error } = await admin
    .from('client_intake')
    .update(update)
    .eq('id', intakeId)
    .select(
      'id, full_name, first_name, last_name, email, phone, practice_area, status, lead_status, matter_id, intake_sent_at, intake_completed_at, engagement_status, engagement_sent_at, engagement_signed_at, engagement_fee_quoted, created_at',
    )
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ row })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: intakeId } = await params
  const admin = getAdminClient()
  try {
    await deleteLead(admin, intakeId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not delete lead'
    const status = msg === 'Lead not found' ? 404 : msg.includes('already converted') ? 409 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
