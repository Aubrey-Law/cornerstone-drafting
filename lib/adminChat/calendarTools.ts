import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { createCalendarHold } from '@/lib/appointments/googleEvents'
import { computeSlots } from '@/lib/appointments/availability'
import { AvailabilityUnavailableError, fetchAllBusy } from '@/lib/appointments/calendarBusy'
import { getSchedulingSettings, listAppointmentTypes } from '@/lib/appointments/settings'
import { effectiveWeeklyHours } from '@/lib/appointments/types'
import { listCalendarView, mapCalendarView } from '@/lib/appointments/googleEvents'
import { fetchDueTasks, fetchTasks } from '@/lib/queries/tasks'
import {
  isUuid,
  TASK_COLUMNS,
} from '@/lib/queries/tasks'
import { effectiveDueAt, taskDueGroup } from '@/lib/tasks/types'
import {
  type ChecklistItem,
  type TaskPriority,
  type TaskSource,
  type TaskType,
  type TaskRow,
  TASK_PRIORITIES,
  TASK_TYPES,
} from '@/lib/tasks/types'
import { actorFrom, logTaskActivity } from '@/lib/tasks/server'
import { proposeWrite } from '@/lib/adminChat/proposals'
import { parseRecurrence as parseRecurrenceText } from '@/lib/tasks/recurrence'
import type { TaskRecurrence } from '@/lib/tasks/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

const DAY_MS = 86_400_000
const TASK_HOLD_TYPE_KEY = 'task_block'

interface CalendarPlanningContext {
  defaultMatterId?: string | null
  defaultLeadId?: string | null
  actor?: {
    id: string
    email?: string | null
    user_metadata?: Record<string, unknown>
  } | null
}

interface CreateTaskInput {
  title: string
  description: string | null
  priority: TaskPriority
  source: TaskSource
  taskType: TaskType
  checklist: ChecklistItem[]
  matterId: string | null
  leadId: string | null
  dueAt: string | null
  assigneeId: string | null
  estimateMinutes: number | null
  remindAt: string | null
  recurrence: TaskRecurrence | null
  templateId: string | null
  documentId: string | null
  calendarAddToCalendar: boolean
  calendarStartAt: string | null
  calendarDurationMinutes: number | null
  calendarShowAsBusy: boolean
}

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Anthropic.Tool => ({
  name,
  description,
  input_schema: { type: 'object', properties, ...(required.length ? { required } : {}) } as Anthropic.Tool.InputSchema,
})

const definitions = {
  list_calendar_range: tool('list_calendar_range', 'List appointments and Outlook events in a date range.', {
    from: { type: 'string', description: 'ISO range start.' },
    to: { type: 'string', description: 'ISO range end.' },
  }, ['from', 'to']),
  find_open_slots: tool('find_open_slots', 'Find verified open slots for an appointment type.', {
    type_id: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
  }, ['type_id', 'from', 'to']),
  create_hold: tool('create_hold', 'Propose a calendar hold. This does not write until the attorney accepts it.', {
    title: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    matter_id: { type: 'string' },
    rationale: { type: 'string' },
  }, ['title', 'start', 'end', 'rationale']),
  propose_reschedule: tool('propose_reschedule', 'Propose moving an appointment without changing it.', {
    appointment_id: { type: 'string' },
    new_start: { type: 'string' },
    rationale: { type: 'string' },
  }, ['appointment_id', 'new_start', 'rationale']),
  find_matter_or_lead: tool('find_matter_or_lead', 'Search matters and leads by client name, email, phone, or matter name. Returns matching matter_id and lead_id values for use with any other tool that requires a matter or lead id.', {
    query: { type: 'string', description: 'Client name, email, phone, or matter name to search for.' },
  }, ['query']),
  create_task: tool('create_task', 'Create a task for the current matter or lead. If calendarAddToCalendar is true, also create a calendar hold.', {
    title: { type: 'string' },
    description: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'normal', 'low'] },
    source: { type: 'string', enum: ['manual', 'template', 'cadence', 'stage'] },
    task_type: { type: 'string', enum: TASK_TYPES },
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          done: { type: 'boolean' },
        },
        required: ['text'],
      },
    },
    matter_id: { type: 'string' },
    lead_id: { type: 'string' },
    due_at: { type: 'string' },
    assignee_id: { type: 'string' },
    estimate_minutes: { type: 'number' },
    remind_at: { type: 'string' },
    recurrence: { type: 'object' },
    template_id: { type: 'string' },
    document_id: { type: 'string' },
    calendarAddToCalendar: { type: 'boolean' },
    calendarStartAt: { type: 'string' },
    calendarDurationMinutes: { type: 'number' },
    calendarShowAsBusy: { type: 'boolean' },
  }, ['title']),
  draft_reschedule_email: tool('draft_reschedule_email', 'Draft, but never send, a client reschedule email.', {
    attendee_name: { type: 'string' },
    old_time: { type: 'string' },
    new_time: { type: 'string' },
    reason: { type: 'string' },
  }, ['attendee_name', 'old_time', 'new_time']),
  list_matter_dates: tool('list_matter_dates', 'List upcoming matter dates and dated tasks.', {
    matter_id: { type: 'string' },
    through: { type: 'string' },
  }),
  list_overdue_followups: tool('list_overdue_followups', 'List overdue follow-up tasks.', {}),
  week_review: tool('week_review', 'Summarize last week meetings, no-shows, stage advances, and slipped work.', {}),
}

function validRange(input: Record<string, unknown>) {
  const from = new Date(typeof input.from === 'string' ? input.from : '')
  const to = new Date(typeof input.to === 'string' ? input.to : '')
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new Error('A valid from/to range is required')
  }
  if (to.getTime() - from.getTime() > 45 * 86_400_000) throw new Error('Range is too large')
  return { from, to }
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = Math.trunc(value)
    return parsed > 0 ? parsed : null
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function optionalBoolean(value: unknown): boolean {
  return value === false ? false : true
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && isUuid(value) ? value : null
}

function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') {
      const text = item.trim()
      return text ? [{ text, done: false }] : []
    }
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    return text ? [{ text, done: raw.done === true }] : []
  })
}

async function getOrCreateTaskHoldType(admin: ReturnType<typeof getAdminClient>): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from('appointment_types')
    .select('id, key')
    .eq('key', TASK_HOLD_TYPE_KEY)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.id) return existing.id as string

  const inserted = await admin.from('appointment_types').insert({
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

  if (inserted.error) {
    if (inserted.error.code !== '23505') throw inserted.error
    const retried = await admin
      .from('appointment_types')
      .select('id, key')
      .eq('key', TASK_HOLD_TYPE_KEY)
      .maybeSingle()
    if (retried.data?.id) return retried.data.id as string
    throw inserted.error
  }

  const { data: refreshed, error: refreshedError } = await admin
    .from('appointment_types')
    .select('id, key')
    .eq('key', TASK_HOLD_TYPE_KEY)
    .maybeSingle()
  if (refreshedError) throw refreshedError
  if (refreshed?.id) return refreshed.id as string
  throw new Error('Unable to initialize task hold appointment type')
}

function taskHoldTypeLabel(taskTitle: string): string {
  return `Task hold: ${taskTitle}`
}

function buildCreateTaskPayload(fields: Record<string, unknown>, context: CalendarPlanningContext): CreateTaskInput {
  const title = typeof fields.title === 'string' ? fields.title.trim() : ''
  if (!title) throw new Error('title is required')

  const matterId = optionalId(fields.matter_id) ?? context.defaultMatterId ?? null
  const leadId = optionalId(fields.lead_id) ?? context.defaultLeadId ?? null
  if (!matterId && !leadId) throw new Error('matter_id or lead_id is required')
  if (matterId && leadId) throw new Error('A task belongs to a matter or a lead, not both')

  const requestedSource = (typeof fields.source === 'string' && ['manual', 'template', 'cadence', 'stage'].includes(fields.source))
    ? (fields.source as TaskSource)
    : 'manual'

  const requestedPriority = (typeof fields.priority === 'string' && TASK_PRIORITIES.includes(fields.priority as TaskPriority))
    ? (fields.priority as TaskPriority)
    : 'normal'

  const requestedType = (typeof fields.task_type === 'string' && TASK_TYPES.includes(fields.task_type as TaskType))
    ? (fields.task_type as TaskType)
    : null

  const checklist = normalizeChecklist(fields.checklist)
  const taskType: TaskType = requestedType ?? (checklist.length > 0 ? 'checklist' : 'single')
  const description = typeof fields.description === 'string' && fields.description.trim()
    ? fields.description.trim()
    : null

  const calendarAddToCalendar = fields.calendarAddToCalendar === true
  const proposedCalendarStart = optionalTimestamp(fields.calendarStartAt)
  const calendarStartAt = proposedCalendarStart ?? optionalTimestamp(fields.due_at)
  const calendarDurationMinutes = parsePositiveInt(fields.calendarDurationMinutes)
  const calendarShowAsBusy = optionalBoolean(fields.calendarShowAsBusy)

  if (calendarAddToCalendar) {
    if (!calendarStartAt) throw new Error('calendarStartAt is required when calendar hold is enabled')
    if (!calendarDurationMinutes) throw new Error('calendarDurationMinutes must be a positive integer')
  }

  return {
    title,
    description,
    priority: requestedPriority,
    source: requestedSource,
    taskType,
    checklist,
    matterId,
    leadId,
    dueAt: optionalTimestamp(fields.due_at),
    assigneeId: optionalId(fields.assignee_id),
    estimateMinutes: parsePositiveInt(fields.estimate_minutes),
    remindAt: optionalTimestamp(fields.remind_at),
    recurrence: parseRecurrenceText(fields.recurrence),
    templateId: optionalId(fields.template_id),
    documentId: optionalId(fields.document_id),
    calendarAddToCalendar,
    calendarStartAt,
    calendarDurationMinutes,
    calendarShowAsBusy,
  }
}

/**
 * Turn an accepted `create_task` proposal into the real task (and, when asked,
 * the appointment and calendar hold). Called only from the acceptance route —
 * the tool itself proposes, it never writes.
 */
export async function acceptTaskProposal(
  fields: Record<string, unknown>,
  actor: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null,
) {
  return createTaskFromInput(buildCreateTaskPayload(fields, {}), actor)
}

async function createTaskFromInput(input: CreateTaskInput, actor: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null) {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('tasks')
    .insert({
      title: input.title,
      description: input.description,
      status: 'open',
      priority: input.priority,
      source: input.source,
      task_type: input.taskType,
      checklist: input.checklist,
      matter_id: input.matterId,
      lead_id: input.leadId,
      due_at: input.dueAt,
      assignee_id: input.assigneeId,
      estimate_minutes: input.estimateMinutes,
      remind_at: input.remindAt,
      recurrence: input.recurrence,
      template_id: input.templateId,
      document_id: input.documentId,
      created_by: actor?.id ?? null,
    })
    .select(TASK_COLUMNS)
    .single()

  if (error) throw new Error(error.message)

  const task = data as unknown as TaskRow
  if (!task) throw new Error('Task creation failed')

  if (input.calendarAddToCalendar && input.calendarStartAt && input.calendarDurationMinutes) {
    const startMs = Date.parse(input.calendarStartAt)
    const endMs = startMs + input.calendarDurationMinutes * 60_000
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      await admin.from('tasks').delete().eq('id', task.id)
      throw new Error('Invalid calendar window')
    }

    try {
      const busy = await fetchAllBusy(new Date(startMs - DAY_MS), new Date(endMs + DAY_MS))
      if (busy.some(interval => startMs < interval.end && endMs > interval.start)) {
        await admin.from('tasks').delete().eq('id', task.id)
        throw new Error('That time overlaps an existing appointment')
      }
    } catch (error) {
      await admin.from('tasks').delete().eq('id', task.id)
      if (error instanceof AvailabilityUnavailableError) {
        throw new Error(error.message)
      }
      throw new Error('Could not verify calendar availability')
    }

    const appointmentTypeId = await getOrCreateTaskHoldType(admin)
    const startIso = new Date(startMs).toISOString()
    const endIso = new Date(endMs).toISOString()
    const attendeeName = taskHoldTypeLabel(input.title)

    const appointment = await admin
      .from('appointments')
      .insert({
        appointment_type_id: appointmentTypeId,
        start_time: startIso,
        end_time: endIso,
        status: 'scheduled',
        attendee_name: attendeeName,
        attendee_email: actor?.email?.toLowerCase() || 'noreply@aubreylegal.com',
        attendee_phone: null,
        notes: `Created from task ${input.title}`,
        linked_lead_id: input.leadId,
        linked_matter_id: input.matterId,
        booked_by_user_id: actor?.id ?? null,
        source: 'admin',
        raw: {
          source: 'task_calendar_hold',
          calendarShowAsBusy: input.calendarShowAsBusy,
          taskId: task.id,
          taskTitle: input.title,
          taskTypeLabel: attendeeName,
          suppressDueReminder: true,
        },
      })
      .select('id')
      .single()

    if (appointment.error || !appointment.data?.id) {
      await admin.from('tasks').delete().eq('id', task.id)
      throw new Error(appointment.error ? appointment.error.message : 'Could not create calendar hold')
    }

    try {
      const hold = await createCalendarHold({
        title: attendeeName,
        startIso,
        endIso,
        matterId: input.matterId,
        showAsBusy: input.calendarShowAsBusy,
      })
      await admin
        .from('appointments')
        .update({ google_event_id: hold.eventId })
        .eq('id', appointment.data.id)
        .is('google_event_id', null)
    } catch {
      console.error('[assistant-calendar-tools] failed to create task calendar hold in Google Calendar', task.id)
    }
  }

  await logTaskActivity(admin, task, 'task_created', actorFrom(actor ?? null))
  return task
}

function proposalExecutor(name: 'create_hold' | 'propose_reschedule'): AdminChatToolExecutor {
  return {
    tool: definitions[name],
    execute: async (input, { toolUseId, emit }) => {
      const fields = (input ?? {}) as Record<string, unknown>
      const proposal = [{
        id: toolUseId,
        title: name === 'create_hold'
          ? String(fields.title ?? 'Calendar hold')
          : 'Reschedule appointment',
        rationale: String(fields.rationale ?? ''),
        kind: name,
        payload: fields,
      }]
      emit({ tool: name, tool_use_id: toolUseId, status: 'done', result: { proposal } })
      return { content: JSON.stringify({ ok: true, proposed: true, changes: proposal, requires_acceptance: true }) }
    },
  }
}

export function calendarPlanningToolExecutors(context: CalendarPlanningContext = {}): AdminChatToolExecutor[] {
  return [
    {
      tool: definitions.list_calendar_range,
      execute: async input => {
        const { from, to } = validRange((input ?? {}) as Record<string, unknown>)
        const admin = getAdminClient()
        const { data } = await admin
          .from('appointments')
          .select('id, start_time, end_time, status, attendee_name, linked_matter_id, google_event_id, microsoft_event_id')
          .gte('start_time', from.toISOString())
          .lt('start_time', to.toISOString())
        const exclude = new Set(
          (data ?? [])
            .flatMap(row => [row.google_event_id, row.microsoft_event_id])
            .filter((id): id is string => Boolean(id)),
        )
        let calendarEvents: unknown[] = []
        let connected = true
        try {
          // `.raw` is the event array; the result object itself would map to
          // nothing and quietly read as an empty calendar.
          const view = await listCalendarView(from.toISOString(), to.toISOString())
          calendarEvents = mapCalendarView(view.raw, exclude)
        } catch {
          connected = false
        }
        return {
          content: JSON.stringify({ appointments: data ?? [], calendar: calendarEvents, connected }),
        }
      },
    },
    {
      tool: definitions.find_open_slots,
      execute: async input => {
        const fields = (input ?? {}) as Record<string, unknown>
        const { from, to } = validRange(fields)
        const type = (await listAppointmentTypes()).find(item => item.id === fields.type_id)
        if (!type) return { content: JSON.stringify({ ok: false, error: 'Unknown appointment type' }), isError: true }
        const settings = await getSchedulingSettings()
        const busy = await fetchAllBusy(from, to)
        const slots = computeSlots({
          weeklyHours: effectiveWeeklyHours(settings.weeklyHours, type),
          timezone: settings.timezone,
          durationMinutes: type.durationMinutes,
          bufferMinutes: settings.bufferMinutes,
          minNoticeHours: 0,
          horizonDays: 45,
          busy,
          now: new Date(),
          rangeStart: from,
          rangeEnd: to,
          dateOverrides: settings.dateOverrides,
        })
        return { content: JSON.stringify({ type: type.label, duration_minutes: type.durationMinutes, slots: slots.slice(0, 30) }) }
      },
    },
    proposalExecutor('create_hold'),
    proposalExecutor('propose_reschedule'),
    {
      tool: definitions.find_matter_or_lead,
      execute: async input => {
        const fields = (input ?? {}) as Record<string, unknown>
        const query = typeof fields.query === 'string' ? fields.query.trim() : ''
        if (!query) return { content: JSON.stringify({ ok: false, error: 'query is required' }), isError: true }

        const admin = getAdminClient()
        const pattern = `%${query.replace(/[%_,]/g, '')}%`

        const [matterResult, leadResult] = await Promise.all([
          admin
            .from('v_matter_pipeline')
            .select('matter_id, matter_name, client_name, client_email, client_phone')
            .or(`client_name.ilike.${pattern},client_email.ilike.${pattern},client_phone.ilike.${pattern},matter_name.ilike.${pattern}`)
            .limit(10),
          admin
            .from('client_intake')
            .select('id, first_name, last_name, full_name, email, phone')
            .is('matter_id', null)
            .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
            .order('updated_at', { ascending: false })
            .limit(10),
        ])

        const matters = matterResult.error ? [] : (matterResult.data ?? []).map(row => ({
          matter_id: row.matter_id as string,
          name: (row.client_name as string | null)?.trim() || (row.matter_name as string | null) || null,
          email: (row.client_email as string | null) ?? null,
          phone: (row.client_phone as string | null) ?? null,
        }))
        const leads = leadResult.error ? [] : (leadResult.data ?? []).map(row => ({
          lead_id: row.id as string,
          name: (row.full_name as string | null)?.trim()
            || `${(row.first_name as string | null) ?? ''} ${(row.last_name as string | null) ?? ''}`.trim()
            || null,
          email: (row.email as string | null) ?? null,
          phone: (row.phone as string | null) ?? null,
        }))

        if (matterResult.error && leadResult.error) {
          return { content: JSON.stringify({ ok: false, error: 'Search failed' }), isError: true }
        }
        return { content: JSON.stringify({ ok: true, matters, leads }) }
      },
    },
    {
      tool: definitions.create_task,
      execute: async (input, { toolUseId, emit }) => {
        try {
          const fields = (input ?? {}) as Record<string, unknown>
          // Validate now so the attorney is never shown a proposal that cannot
          // be accepted — but do not write. A task can create an appointment and
          // a real calendar event, and client-authored text reaches this prompt.
          const validated = buildCreateTaskPayload(fields, context)
          return proposeWrite({
            kind: 'create_task',
            toolName: definitions.create_task.name,
            toolUseId,
            emit,
            title: validated.title,
            rationale: validated.description ?? '',
            payload: {
              ...fields,
              title: validated.title,
              matter_id: validated.matterId,
              lead_id: validated.leadId,
            },
          })
        } catch (error) {
          return {
            content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Could not create task' }),
            isError: true,
          }
        }
      },
    },
    {
      tool: definitions.draft_reschedule_email,
      execute: async input => {
        const fields = (input ?? {}) as Record<string, unknown>
        const draft = `Subject: A new time for our meeting\n\nHi ${String(fields.attendee_name ?? '')},\n\nWould ${String(fields.new_time ?? '')} work in place of ${String(fields.old_time ?? '')}? ${String(fields.reason ?? '')}\n\nPlease let me know, and I will update the calendar invitation.`
        return { content: JSON.stringify({ draft, destination: 'email_tab', sent: false }) }
      },
    },
    {
      tool: definitions.list_matter_dates,
      execute: async input => {
        const fields = (input ?? {}) as Record<string, unknown>
        const tasks = await fetchTasks({ status: 'open', recordId: typeof fields.matter_id === 'string' ? fields.matter_id : null })
        return { content: JSON.stringify(tasks.map(task => ({ title: task.title, date: effectiveDueAt(task), estimate_minutes: task.estimate_minutes }))) }
      },
    },
    {
      tool: definitions.list_overdue_followups,
      execute: async () => {
        // Overdue is a due-window question; the old read took an arbitrary 500
        // of every open task and filtered that, so it answered from a sample.
        const tasks = await fetchDueTasks(new Date().toISOString())
        return { content: JSON.stringify(tasks.filter(task => taskDueGroup(task) === 'overdue' && /follow.?up|call|email|note/i.test(task.title)).slice(0, 50)) }
      },
    },
    {
      tool: definitions.week_review,
      execute: async () => {
        const admin = getAdminClient()
        const to = new Date()
        const from = new Date(to.getTime() - 7 * 86_400_000)
        const [appointments, stages, tasks] = await Promise.all([
          admin.from('appointments').select('status, linked_matter_id').gte('start_time', from.toISOString()).lt('start_time', to.toISOString()),
          admin.from('matter_activity').select('matter_id').eq('event_type', 'stage_changed').gte('created_at', from.toISOString()),
          fetchDueTasks(to.toISOString()),
        ])
        return { content: JSON.stringify({
          meetings: (appointments.data ?? []).filter(row => row.status === 'scheduled').length,
          no_shows: (appointments.data ?? []).filter(row => row.status === 'no_show').length,
          matters_advanced: new Set((stages.data ?? []).map(row => row.matter_id)).size,
          slipped: tasks.filter(task => taskDueGroup(task) === 'overdue').map(task => task.title).slice(0, 10),
        }) }
      },
    },
  ]
}

export function calendarPlanningSystemPromptNote() {
  return `\n\nCALENDAR PLANNING: Use the calendar tools for day/week planning and risk review. Calendar writes are proposals only: never claim a hold or reschedule happened until the attorney explicitly accepts it. Reschedule proposals should not draft email content automatically.\n\nTASK MANAGEMENT: Use create_task to propose tasks for a matter or lead when needed. Task creation is a proposal like calendar writes: the task is created only when the attorney presses accept. Never say a task was created — say you have proposed it and it needs their acceptance. For meeting blocks, set calendarAddToCalendar true and provide a positive calendarDurationMinutes.\n\nUse create_task only when requested explicitly by the attorney, and include either matter_id or lead_id (defaults are used from chat context when available).

RECORD LOOKUP: Whenever any tool needs a matter_id or lead_id — creating tasks, calendar holds, listing matter dates, rendering templates, or anything else — and the attorney has named a client or matter without an id in context, call find_matter_or_lead with the client name, email, phone, or matter name to resolve it yourself. Never ask the attorney to supply a raw id. If the search returns exactly one match, use it; if it returns several, ask the attorney which one they mean (show name and email, not ids); if it returns none, say so and ask how to proceed.`
}
