import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createActionProposal, executeActionProposal } from '@/lib/actions/server'
import type { ActionProposalRequest } from '@/lib/actions/types'

/**
 * Where an assistant proposal becomes a write.
 *
 * The mutating tools return proposals rather than executing, because
 * client-authored text (intake answers, matter notes, uploaded documents)
 * reaches the same system prompt the tools are described in. This route runs
 * under the attorney's own session and adapts the card into the shared action
 * registry. The registry re-validates current state and owns idempotency and
 * audit; this route no longer performs those writes directly.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId || !auth.user) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { kind?: unknown; payload?: Record<string, unknown>; proposalId?: unknown }
  const payload = body.payload ?? {}
  const proposalId = typeof body.proposalId === 'string' ? body.proposalId.trim() : ''

  if (!proposalId || proposalId.length > 200) {
    return NextResponse.json({ error: 'A valid assistant proposal identifier is required' }, { status: 400 })
  }

  const mapped: Record<string, { actionKey: string; summary: string }> = {
    create_task: { actionKey: 'task.create', summary: typeof payload.title === 'string' ? `Create task: ${payload.title}` : 'Create task' },
    create_lead: { actionKey: 'lead.create', summary: typeof payload.client_name === 'string' ? `Create lead: ${payload.client_name}` : 'Create lead' },
    create_hold: { actionKey: 'calendar.hold.create', summary: typeof payload.title === 'string' ? `Create calendar hold: ${payload.title}` : 'Create calendar hold' },
    register_custom_template: { actionKey: 'template.register', summary: typeof payload.label === 'string' ? `Register template: ${payload.label}` : 'Register template' },
  }

  const mapping = typeof body.kind === 'string' ? mapped[body.kind] : undefined
  if (mapping) {
    const recordType: ActionProposalRequest['recordType'] = typeof payload.matter_id === 'string'
      ? 'matter'
      : typeof payload.lead_id === 'string'
        ? 'lead'
        : 'firm'
    const recordId = recordType === 'matter'
      ? payload.matter_id as string
      : recordType === 'lead'
        ? payload.lead_id as string
        : undefined
    try {
      const created = await createActionProposal({
        actionKey: mapping.actionKey,
        displaySummary: mapping.summary,
        referencePayload: payload,
        recordType,
        recordId,
        idempotencyKey: `assistant:${auth.userId}:${proposalId}`,
        source: 'assistant',
      }, auth.user)
      const executed = await executeActionProposal(String(created.proposal.id), auth.user)
      const result = executed.result as Record<string, unknown> | undefined
      return NextResponse.json({
        ok: true,
        proposalId: created.proposal.id,
        executionId: (executed.execution as { id?: string } | null)?.id ?? null,
        duplicate: executed.duplicate,
        result: result ?? null,
        ...(mapping.actionKey === 'lead.create' && typeof result?.leadId === 'string'
          ? { leadId: result.leadId, clientName: result.clientName, url: `/admin/crm/opportunities/${result.leadId}` }
          : {}),
        ...(mapping.actionKey === 'task.create' && typeof result?.id === 'string'
          ? { taskId: result.id, title: result.title }
          : {}),
        ...(mapping.actionKey === 'calendar.hold.create' && typeof result?.eventId === 'string'
          ? { eventId: result.eventId }
          : {}),
        ...(mapping.actionKey === 'template.register' && typeof result?.id === 'string'
          ? { templateId: result.id, label: result.label }
          : {}),
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not apply this proposal' },
        { status: 400 },
      )
    }
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
