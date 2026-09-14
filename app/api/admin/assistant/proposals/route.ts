import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createCalendarHold } from '@/lib/appointments/googleEvents'
import { acceptTaskProposal } from '@/lib/adminChat/calendarTools'
import { createLead } from '@/lib/leads/createLead'

/**
 * Where an assistant proposal becomes a write.
 *
 * The mutating tools return proposals rather than executing, because
 * client-authored text (intake answers, matter notes, uploaded documents)
 * reaches the same system prompt the tools are described in. This route runs
 * under the attorney's own session, re-validates the payload the card carried,
 * and is the only place those writes happen.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { kind?: unknown; payload?: Record<string, unknown> }
  const payload = body.payload ?? {}

  if (body.kind === 'create_task') {
    try {
      const task = await acceptTaskProposal(payload, auth.user)
      return NextResponse.json({ ok: true, taskId: task.id, title: task.title })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not create the task' },
        { status: 400 },
      )
    }
  }

  if (body.kind === 'create_lead') {
    const clientName = typeof payload.client_name === 'string' ? payload.client_name.trim() : ''
    const clientEmail = typeof payload.client_email === 'string' ? payload.client_email.trim() : ''
    if (!clientName || !clientEmail.includes('@')) {
      return NextResponse.json({ error: 'A client name and email are required' }, { status: 400 })
    }
    const created = await createLead({
      clientName,
      clientEmail,
      clientPhone: typeof payload.client_phone === 'string' ? payload.client_phone : null,
      practiceArea: typeof payload.practice_area === 'string' ? payload.practice_area : 'EP',
      feeQuoted: typeof payload.fee_quoted === 'number' ? payload.fee_quoted : null,
    })
    return NextResponse.json({
      ok: true,
      leadId: created.leadId,
      clientName: created.clientName,
      url: `/admin/crm/opportunities/${created.leadId}`,
    })
  }

  if (body.kind === 'register_custom_template') {
    const label = typeof payload.label === 'string' ? payload.label.trim() : ''
    const uploadId = typeof payload.upload_id === 'string' ? payload.upload_id : ''
    if (!label || !uploadId) return NextResponse.json({ error: 'A label and upload are required' }, { status: 400 })
    const { getTemplateBuilderUpload, loadTemplateBuilderBuffer } = await import('@/lib/templateBuilder/uploads')
    const { createCustomTemplate } = await import('@/lib/documentTemplates/customTemplates')
    const row = await getTemplateBuilderUpload(uploadId)
    if (!row) return NextResponse.json({ error: 'That template upload no longer exists' }, { status: 404 })
    try {
      const created = await createCustomTemplate({
        label,
        buffer: await loadTemplateBuilderBuffer(row),
        actorId: auth.userId,
        outputFilename: typeof payload.output_filename === 'string' ? payload.output_filename : undefined,
      })
      return NextResponse.json({ ok: true, templateId: created.id, label: created.label })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not register the template' },
        { status: 400 },
      )
    }
  }

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
    const { getAdminClient } = await import('@/lib/supabaseAdmin')
    const { data: appointment } = await getAdminClient()
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
      proposal: { appointmentId, proposedStart },
      requires_attention: Boolean(appointment.linked_matter_id || appointment.linked_lead_id),
    })
  }

  return NextResponse.json({ error: 'Unsupported proposal' }, { status: 400 })
}
