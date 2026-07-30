import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createCalendarHold } from '@/lib/appointments/graphEvents'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as {
    kind?: unknown
    payload?: Record<string, unknown>
  }
  const payload = body.payload ?? {}
  if (body.kind === 'create_hold') {
    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    const start = typeof payload.start === 'string' ? payload.start : ''
    const end = typeof payload.end === 'string' ? payload.end : ''
    if (!title || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
      return NextResponse.json({ error: 'Valid title, start, and end are required' }, { status: 400 })
    }
    const result = await createCalendarHold({
      title,
      startIso: new Date(start).toISOString(),
      endIso: new Date(end).toISOString(),
      matterId: typeof payload.matter_id === 'string' ? payload.matter_id : null,
    })
    return NextResponse.json({ ok: true, eventId: result.eventId })
  }
  if (body.kind === 'propose_reschedule') {
    // A client-facing move first becomes an email draft; it is never sent here.
    const appointmentId = typeof payload.appointment_id === 'string' ? payload.appointment_id : ''
    const { data: appointment } = await (await import('@/lib/supabaseAdmin')).getAdminClient()
      .from('appointments')
      .select('attendee_name, attendee_email, start_time, linked_matter_id, linked_lead_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    const proposedStart = typeof payload.new_start === 'string' ? payload.new_start : ''
    if (!Number.isFinite(Date.parse(proposedStart))) {
      return NextResponse.json({ error: 'Valid new_start is required' }, { status: 400 })
    }
    // The proposal originates on /admin/calendar, whose rail email context is general.
    const contextType = 'general'
    const contextId = null
    const admin = (await import('@/lib/supabaseAdmin')).getAdminClient()
    let existingQuery = admin
      .from('email_drafts')
      .select('id')
      .eq('user_id', auth.userId)
      .eq('context_type', contextType)
    existingQuery = contextId ? existingQuery.eq('context_id', contextId) : existingQuery.is('context_id', null)
    const existing = await existingQuery.maybeSingle()
    const proposedLabel = new Date(proposedStart).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    })
    const draft = {
      user_id: auth.userId,
      context_type: contextType,
      context_id: contextId,
      to_email: appointment.attendee_email,
      cc: [],
      bcc: [],
      template_id: null,
      subject: 'Proposed appointment time change',
      body_html: `<p>Hi ${escapeHtml(appointment.attendee_name)},</p><p>Would ${escapeHtml(proposedLabel)} work for our meeting?</p><p>Please let me know, and I will update the calendar invitation.</p>`,
      document_ids: [],
      include_signature: true,
      updated_at: new Date().toISOString(),
    }
    const result = existing.data
      ? await admin.from('email_drafts').update(draft).eq('id', existing.data.id)
      : await admin.from('email_drafts').insert(draft)
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    return NextResponse.json({
      ok: true,
      draftOnly: true,
      emailDraft: {
        appointmentId,
        proposedStart,
        subject: 'Proposed appointment time change',
      },
    })
  }
  return NextResponse.json({ error: 'Unsupported proposal' }, { status: 400 })
}
