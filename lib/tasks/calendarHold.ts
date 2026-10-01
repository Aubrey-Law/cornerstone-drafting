import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createCalendarHold } from '@/lib/appointments/googleEvents'
import { AvailabilityUnavailableError, fetchAllBusy } from '@/lib/appointments/calendarBusy'
import { getOrCreateInternalHoldType } from '@/lib/appointments/internalHoldType'
import type { TaskRow } from '@/lib/tasks/types'

const DAY_MS = 86_400_000

export class TaskCalendarHoldError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 500 | 503 = 500) {
    super(message)
    this.name = 'TaskCalendarHoldError'
  }
}

export interface TaskCalendarHoldResult {
  appointmentId: string
  startAt: string
  endAt: string
  alreadyExists: boolean
  calendarSynced: boolean
}

/**
 * Put one active planning hold on an existing task. The task id is the stable
 * idempotency key; retrying the same action returns the existing appointment
 * rather than creating another task or another calendar event.
 */
export async function createTaskCalendarHold(input: {
  admin: SupabaseClient
  task: Pick<TaskRow, 'id' | 'title' | 'matter_id' | 'lead_id'>
  startAt: string
  durationMinutes: number
  showAsBusy: boolean
  actorId: string | null
  actorEmail: string | null
}): Promise<TaskCalendarHoldResult> {
  const startMs = Date.parse(input.startAt)
  const durationMinutes = Math.trunc(input.durationMinutes)
  const endMs = startMs + durationMinutes * 60_000
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || durationMinutes <= 0 || endMs <= startMs) {
    throw new TaskCalendarHoldError('Invalid calendar window', 400)
  }

  const { data: existing, error: existingError } = await input.admin
    .from('appointments')
    .select('id, start_time, end_time, google_event_id')
    .eq('status', 'scheduled')
    .contains('raw', { source: 'task_calendar_hold', taskId: input.task.id })
    .limit(1)
    .maybeSingle()
  if (existingError) throw new TaskCalendarHoldError(existingError.message)
  if (existing) {
    return {
      appointmentId: existing.id as string,
      startAt: existing.start_time as string,
      endAt: existing.end_time as string,
      alreadyExists: true,
      calendarSynced: Boolean(existing.google_event_id),
    }
  }

  try {
    const busy = await fetchAllBusy(new Date(startMs - DAY_MS), new Date(endMs + DAY_MS))
    if (busy.some(interval => startMs < interval.end && endMs > interval.start)) {
      throw new TaskCalendarHoldError('That time overlaps an existing appointment', 409)
    }
  } catch (error) {
    if (error instanceof TaskCalendarHoldError) throw error
    if (error instanceof AvailabilityUnavailableError) {
      throw new TaskCalendarHoldError(error.message, 503)
    }
    throw new TaskCalendarHoldError('Could not verify calendar availability')
  }

  const appointmentTypeId = await getOrCreateInternalHoldType(input.admin)
  const startIso = new Date(startMs).toISOString()
  const endIso = new Date(endMs).toISOString()
  const attendeeName = `Task hold: ${input.task.title}`
  const { data: appointment, error: appointmentError } = await input.admin
    .from('appointments')
    .insert({
      appointment_type_id: appointmentTypeId,
      start_time: startIso,
      end_time: endIso,
      status: 'scheduled',
      attendee_name: attendeeName,
      attendee_email: input.actorEmail?.toLowerCase() || 'noreply@aubreylegal.com',
      attendee_phone: null,
      notes: `Created from task ${input.task.title}`,
      linked_lead_id: input.task.lead_id,
      linked_matter_id: input.task.matter_id,
      booked_by_user_id: input.actorId,
      source: 'admin',
      raw: {
        source: 'task_calendar_hold',
        calendarShowAsBusy: input.showAsBusy,
        taskId: input.task.id,
        taskTitle: input.task.title,
        taskTypeLabel: attendeeName,
        suppressDueReminder: true,
      },
    })
    .select('id')
    .single()
  if (appointmentError || !appointment?.id) {
    throw new TaskCalendarHoldError(appointmentError?.message ?? 'Could not create calendar hold')
  }

  let calendarSynced = false
  try {
    const hold = await createCalendarHold({
      title: attendeeName,
      startIso,
      endIso,
      matterId: input.task.matter_id,
      showAsBusy: input.showAsBusy,
      idempotencyKey: `task:${input.task.id}`,
    })
    const update = await input.admin
      .from('appointments')
      .update({ google_event_id: hold.eventId })
      .eq('id', appointment.id)
      .is('google_event_id', null)
    calendarSynced = !update.error
  } catch {
    console.error('[task-calendar-hold] failed to create Google Calendar hold', input.task.id)
  }

  return {
    appointmentId: appointment.id as string,
    startAt: startIso,
    endAt: endIso,
    alreadyExists: false,
    calendarSynced,
  }
}
