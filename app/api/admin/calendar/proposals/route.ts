import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createCalendarHold } from '@/lib/appointments/graphEvents'

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
      showAsBusy: payload.calendarShowAsBusy !== false,
    })
    return NextResponse.json({ ok: true, eventId: result.eventId })
  }
  if (body.kind === 'propose_reschedule') {
    const appointmentId = typeof payload.appointment_id === 'string' ? payload.appointment_id : ''
    const { data: appointment } = await (await import('@/lib/supabaseAdmin')).getAdminClient()
      .from('appointments')
      .select('id, start_time, linked_matter_id, linked_lead_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

    const proposedStart = typeof payload.new_start === 'string' ? payload.new_start : ''
    if (!Number.isFinite(Date.parse(proposedStart))) {
      return NextResponse.json({ error: 'Valid new_start is required' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      proposal: {
        appointmentId,
        proposedStart,
      },
      requires_attention: Boolean(appointment.linked_matter_id || appointment.linked_lead_id),
    })
  }
  return NextResponse.json({ error: 'Unsupported proposal' }, { status: 400 })
}
