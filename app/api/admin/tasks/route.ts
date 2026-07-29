import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS, fetchTasks, isUuid, type TaskScope } from '@/lib/queries/tasks'
import { actorFrom, logTaskActivity } from '@/lib/tasks/server'
import { parseRecurrence } from '@/lib/tasks/recurrence'
import {
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_TYPES,
  type ChecklistItem,
  type TaskPriority,
  type TaskRow,
  type TaskSource,
  type TaskType,
} from '@/lib/tasks/types'

const SCOPES: TaskScope[] = ['mine', 'team', 'unassigned', 'all']

function parseScope(value: string | null): TaskScope {
  return SCOPES.includes(value as TaskScope) ? (value as TaskScope) : 'all'
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status')
  const sourceParam = url.searchParams.get('source')
  const assignee = url.searchParams.get('assignee')
  const recordId = url.searchParams.get('recordId')

  const tasks = await fetchTasks({
    scope: parseScope(url.searchParams.get('scope')),
    viewerId: auth.userId,
    assignee: assignee && isUuid(assignee) ? assignee : null,
    source: TASK_SOURCES.includes(sourceParam as TaskSource) ? (sourceParam as TaskSource) : 'all',
    status: statusParam === 'done' || statusParam === 'all' ? statusParam : 'open',
    recordId: recordId && isUuid(recordId) ? recordId : null,
  })

  return NextResponse.json({ tasks })
}

interface CreateBody {
  title?: unknown
  description?: unknown
  priority?: unknown
  source?: unknown
  task_type?: unknown
  checklist?: unknown
  matter_id?: unknown
  lead_id?: unknown
  due_at?: unknown
  assignee_id?: unknown
  estimate_minutes?: unknown
  remind_at?: unknown
  recurrence?: unknown
  template_id?: unknown
  document_id?: unknown
}

function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return item.trim() ? [{ text: item.trim(), done: false }] : []
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    return typeof raw.text === 'string' && raw.text.trim()
      ? [{ text: raw.text.trim(), done: raw.done === true }]
      : []
  })
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && isUuid(value) ? value : null
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'A task needs a title' }, { status: 400 })

  const matterId = optionalId(body.matter_id)
  const leadId = optionalId(body.lead_id)
  if (matterId && leadId) {
    return NextResponse.json({ error: 'A task belongs to a matter or a lead, not both' }, { status: 400 })
  }

  const checklist = normalizeChecklist(body.checklist)
  const requestedType = TASK_TYPES.includes(body.task_type as TaskType)
    ? (body.task_type as TaskType)
    : null
  const taskType: TaskType = requestedType ?? (checklist.length > 0 ? 'checklist' : 'single')

  const estimate = Number(body.estimate_minutes)

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('tasks')
    .insert({
      title,
      description: typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null,
      status: 'open',
      priority: TASK_PRIORITIES.includes(body.priority as TaskPriority)
        ? (body.priority as TaskPriority)
        : 'normal',
      // The stage engine is the only writer of `stage` tasks; anything created
      // through this route is firm-authored work.
      source: body.source === 'template' || body.source === 'cadence' ? body.source : 'manual',
      task_type: taskType,
      checklist,
      matter_id: matterId,
      lead_id: leadId,
      due_at: optionalTimestamp(body.due_at),
      assignee_id: optionalId(body.assignee_id),
      estimate_minutes: Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate) : null,
      remind_at: optionalTimestamp(body.remind_at),
      recurrence: parseRecurrence(body.recurrence),
      template_id: optionalId(body.template_id),
      document_id: optionalId(body.document_id),
      created_by: auth.userId,
    })
    .select(TASK_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const task = data as unknown as TaskRow
  await logTaskActivity(admin, task, 'task_created', actorFrom(auth.user))

  return NextResponse.json({ task }, { status: 201 })
}
