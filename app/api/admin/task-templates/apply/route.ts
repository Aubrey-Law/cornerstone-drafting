import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS, isUuid } from '@/lib/queries/tasks'
import { addBusinessDays } from '@/lib/stage-engine/businessDays'
import type { TaskPriority, TaskRow } from '@/lib/tasks/types'

interface ApplyBody {
  template_id?: unknown
  matter_id?: unknown
  lead_id?: unknown
  assignee_id?: unknown
}

interface TemplateItem {
  text: string
  offset_days?: number
  priority?: TaskPriority
}

/** Create one task per template item on a matter or lead. */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = (await req.json().catch(() => ({}))) as ApplyBody
  const templateId = typeof body.template_id === 'string' && isUuid(body.template_id)
    ? body.template_id
    : null
  if (!templateId) return NextResponse.json({ error: 'template_id is required' }, { status: 400 })

  const matterId = typeof body.matter_id === 'string' && isUuid(body.matter_id) ? body.matter_id : null
  const leadId = typeof body.lead_id === 'string' && isUuid(body.lead_id) ? body.lead_id : null
  if (matterId && leadId) {
    return NextResponse.json({ error: 'A task belongs to a matter or a lead, not both' }, { status: 400 })
  }

  const assigneeId = typeof body.assignee_id === 'string' && isUuid(body.assignee_id)
    ? body.assignee_id
    : null

  const admin = getAdminClient()
  const { data: template, error: templateError } = await admin
    .from('task_templates')
    .select('id, name, items')
    .eq('id', templateId)
    .maybeSingle()

  if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const items = (template.items ?? []) as TemplateItem[]
  if (items.length === 0) {
    return NextResponse.json({ error: 'That template has no tasks' }, { status: 400 })
  }

  const now = new Date()
  const rows = items
    .filter(item => typeof item.text === 'string' && item.text.trim())
    .map(item => ({
      title: item.text.trim(),
      status: 'open',
      priority: item.priority ?? 'normal',
      source: 'template',
      task_type: 'single',
      checklist: [],
      matter_id: matterId,
      lead_id: leadId,
      // Offsets are business days so a template lands on working days.
      due_at: item.offset_days ? addBusinessDays(now, item.offset_days).toISOString() : null,
      assignee_id: assigneeId,
      template_id: template.id,
      created_by: auth.userId,
    }))

  const { data, error } = await admin.from('tasks').insert(rows).select(TASK_COLUMNS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tasks: (data ?? []) as unknown as TaskRow[] }, { status: 201 })
}
