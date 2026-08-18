import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS, fetchTasks, isUuid, type TaskScope } from '@/lib/queries/tasks'
import { actorFrom, logTaskActivity } from '@/lib/tasks/server'
import { parseRecurrence } from '@/lib/tasks/recurrence'
import { createCalendarHold } from '@/lib/appointments/graphEvents'
import { AvailabilityUnavailableError, fetchAllBusy } from '@/lib/appointments/graphBusy'
import {
  TASK_OWNERS,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_TYPES,
  type ChecklistItem,
  type TaskOwner,
  type TaskPriority,
  type TaskRow,
  type TaskSource,
  type TaskType,
} from '@/lib/tasks/types'
import { isSlaPhase } from '@/lib/slaTasks/types'

const SCOPES: TaskScope[] = ['mine', 'team', 'unassigned', 'all']
const TASK_HOLD_TYPE_KEY = 'task_block'
const DAY_MS = 86_400_000

function parseScope(value: string | null): TaskScope {
  return SCOPES.includes(value as TaskScope) ? (value as TaskScope) : 'all'
}

function optionalBoolean(value: unknown): boolean {
  return value === false ? false : true
}

function optionalDurationMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.trunc(value)
    return rounded > 0 ? rounded : null
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : null
  }
  return null
}

function taskHoldTypeLabel(taskTitle: string): string {
  return `Task hold: ${taskTitle}`
}

async function getOrCreateTaskHoldType(admin: ReturnType<typeof getAdminClient>): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from('appointment_types')
    .select('id, key')
    .eq('key', TASK_HOLD_TYPE_KEY)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.id) return existing.id as string

  const insert = await admin.from('appointment_types').insert({
    key: TASK_HOLD_TYPE_KEY,
    slug: 'task-block',
    label: 'Task hold',
    description: 'Internal planning hold created from tasks.',
    duration_minutes: 30,
    location_type: 'phone',
    location_types: ['phone'],
    active: false,
    public: false,
    sort: 999,
  } as const)

  if (insert.error) {
    if (insert.error.code !== '23505') throw insert.error
    const retried = await admin
      .from('appointment_types')
      .select('id, key')
      .eq('key', TASK_HOLD_TYPE_KEY)
      .maybeSingle()
    if (retried.data?.id) return retried.data.id as string
    throw insert.error
  }

  const refreshed = await admin
    .from('appointment_types')
    .select('id, key')
    .eq('key', TASK_HOLD_TYPE_KEY)
    .maybeSingle()
  if (refreshed.data?.id) return refreshed.data.id as string
  throw insert.error ?? new Error('Unable to initialize task hold appointment type')
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status')
  const sourceParam = url.searchParams.get('source')
  const assignee = url.searchParams.get('assignee')
  const recordId = url.searchParams.get('recordId')
  const ownerParam = url.searchParams.get('owner')

  const tasks = await fetchTasks({
    scope: parseScope(url.searchParams.get('scope')),
    viewerId: auth.userId,
    assignee: assignee && isUuid(assignee) ? assignee : null,
    source: TASK_SOURCES.includes(sourceParam as TaskSource) ? (sourceParam as TaskSource) : 'all',
    status: statusParam === 'done' || statusParam === 'all' ? statusParam : 'open',
    recordId: recordId && isUuid(recordId) ? recordId : null,
    // The plan view asks for everything — client- and automation-owned rows and
    // the skipped ones — because it is a picture of the matter, not a work list.
    owner:
      ownerParam === 'all' || TASK_OWNERS.includes(ownerParam as TaskOwner)
        ? (ownerParam as TaskOwner | 'all')
        : 'firm',
    includeArchived: url.searchParams.get('includeArchived') === '1',
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
  phase?: unknown
  due_at?: unknown
  assignee_id?: unknown
  estimate_minutes?: unknown
  remind_at?: unknown
  recurrence?: unknown
  template_id?: unknown
  document_id?: unknown
  calendarAddToCalendar?: unknown
  calendarStartAt?: unknown
  calendarDurationMinutes?: unknown
  calendarShowAsBusy?: unknown
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
  const calendarAddToCalendar = body.calendarAddToCalendar === true
  const calendarStartAt = optionalTimestamp(body.calendarStartAt)
  const calendarDurationMinutes = optionalDurationMinutes(body.calendarDurationMinutes)
  const calendarShowAsBusy = optionalBoolean(body.calendarShowAsBusy)
  if (calendarAddToCalendar && !calendarStartAt) {
    return NextResponse.json({ error: 'calendarStartAt is required when calendar hold is enabled' }, { status: 400 })
  }
  if (calendarAddToCalendar && !calendarDurationMinutes) {
    return NextResponse.json({ error: 'calendarDurationMinutes must be a positive integer' }, { status: 400 })
  }

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
      // Set when the task is added from the plan view, so hand-added work lands
      // in the phase it belongs to instead of falling out of the plan entirely.
      phase: isSlaPhase(body.phase) ? body.phase : null,
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

  if (calendarAddToCalendar && calendarStartAt && calendarDurationMinutes) {
    const startMs = Date.parse(calendarStartAt)
    const endMs = startMs + calendarDurationMinutes * 60_000
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      await admin.from('tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: 'Invalid calendar window' }, { status: 400 })
    }

    let appointmentTypeId: string
    try {
      const startIso = new Date(startMs).toISOString()
      const endIso = new Date(endMs).toISOString()

      try {
        const busy = await fetchAllBusy(new Date(startMs - DAY_MS), new Date(endMs + DAY_MS))
        if (busy.some(interval => startMs < interval.end && endMs > interval.start)) {
          await admin.from('tasks').delete().eq('id', task.id)
          return NextResponse.json({ error: 'That time overlaps an existing appointment' }, { status: 409 })
        }
      } catch (err) {
        await admin.from('tasks').delete().eq('id', task.id)
        if (err instanceof AvailabilityUnavailableError) {
          return NextResponse.json({ error: err.message }, { status: 503 })
        }
        return NextResponse.json({ error: 'Could not verify calendar availability' }, { status: 500 })
      }

      appointmentTypeId = await getOrCreateTaskHoldType(admin)

      const ownerEmail = auth.user?.email?.toLowerCase() || 'noreply@aubreylegal.com'
      const attendeeName = taskHoldTypeLabel(task.title)

      const { data: appointmentData, error: appointmentError } = await admin
        .from('appointments')
        .insert({
          appointment_type_id: appointmentTypeId,
          start_time: startIso,
          end_time: endIso,
          status: 'scheduled',
          attendee_name: attendeeName,
          attendee_email: ownerEmail,
          attendee_phone: null,
          notes: `Created from task ${task.title}`,
          linked_lead_id: leadId,
          linked_matter_id: matterId,
          booked_by_user_id: auth.userId,
          source: 'admin',
          raw: {
            source: 'task_calendar_hold',
            calendarShowAsBusy,
            taskId: task.id,
            taskTitle: task.title,
            taskTypeLabel: `${attendeeName}`,
            suppressDueReminder: true,
          },
        })
        .select('id')
        .single()

      if (appointmentError) {
        await admin.from('tasks').delete().eq('id', task.id)
        return NextResponse.json({ error: appointmentError.message }, { status: 500 })
      }

      try {
        const hold = await createCalendarHold({
          title: attendeeName,
          startIso,
          endIso,
          matterId,
          showAsBusy: calendarShowAsBusy,
        })
        await admin
          .from('appointments')
          .update({ microsoft_event_id: hold.eventId })
          .eq('id', appointmentData.id)
          .is('microsoft_event_id', null)
      } catch {
        console.error('[tasks] failed to create task calendar hold in Outlook', task.id)
      }
    } catch (err) {
      console.error('[tasks] failed to create task calendar hold', err)
      await admin.from('tasks').delete().eq('id', task.id)
      return NextResponse.json({
        error: err instanceof Error ? err.message : 'Could not create calendar hold',
      }, { status: 500 })
    }
  }

  await logTaskActivity(admin, task, 'task_created', actorFrom(auth.user))

  return NextResponse.json({ task }, { status: 201 })
}
