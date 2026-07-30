import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { computeSlots } from '@/lib/appointments/availability'
import { fetchAllBusy } from '@/lib/appointments/graphBusy'
import { getSchedulingSettings, listAppointmentTypes } from '@/lib/appointments/settings'
import { effectiveWeeklyHours } from '@/lib/appointments/types'
import { listCalendarView, mapGraphCalendarView } from '@/lib/appointments/graphEvents'
import { fetchTasks } from '@/lib/queries/tasks'
import { effectiveDueAt, taskDueGroup } from '@/lib/tasks/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

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

export function calendarPlanningToolExecutors(): AdminChatToolExecutor[] {
  return [
    {
      tool: definitions.list_calendar_range,
      execute: async input => {
        const { from, to } = validRange((input ?? {}) as Record<string, unknown>)
        const admin = getAdminClient()
        const { data } = await admin
          .from('appointments')
          .select('id, start_time, end_time, status, attendee_name, linked_matter_id, microsoft_event_id')
          .gte('start_time', from.toISOString())
          .lt('start_time', to.toISOString())
        const exclude = new Set((data ?? []).map(row => row.microsoft_event_id).filter((id): id is string => Boolean(id)))
        let outlook: unknown[] = []
        let connected = true
        try {
          outlook = mapGraphCalendarView(await listCalendarView(from.toISOString(), to.toISOString()), exclude)
        } catch {
          connected = false
        }
        return { content: JSON.stringify({ appointments: data ?? [], outlook, connected }) }
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
        const tasks = await fetchTasks({ status: 'open', limit: 500 })
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
          fetchTasks({ status: 'open', limit: 500 }),
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
  return '\n\nCALENDAR PLANNING: Use the calendar tools for day/week planning and risk review. Calendar writes are proposals only: never claim a hold or reschedule happened until the attorney explicitly accepts it. Reschedule communications must be drafted for the Email tab and never sent automatically.'
}
