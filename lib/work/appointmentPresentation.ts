import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { TodayAppointment } from '@/lib/queries/today'
import type { WorkItem } from '@/lib/work/types'

const appointmentTime = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: FIRM_TIMEZONE,
})

export type AppointmentPreparationStatus = {
  label: string
  tone: 'muted' | 'normal' | 'urgent' | 'warning'
}

/** Mirrors the work-graph key so appointment context can find its prep work without a second query. */
export function appointmentPreparationWorkKey(appointment: Pick<TodayAppointment, 'id'>) {
  return `appointment:${appointment.id}:prepare`
}

export function formatAppointmentTime(appointment: TodayAppointment) {
  if (appointment.is_all_day) return 'All day'

  const startAt = Date.parse(appointment.next_appointment)
  if (Number.isNaN(startAt)) return 'Scheduled'

  const endAt = appointment.end_at ? Date.parse(appointment.end_at) : Number.NaN
  if (!Number.isNaN(endAt) && endAt > startAt) {
    return `${appointmentTime.format(new Date(startAt))}\u2013${appointmentTime.format(new Date(endAt))}`
  }

  return appointmentTime.format(new Date(startAt))
}

export function getAppointmentPreparationStatus(
  appointment: TodayAppointment,
  items: WorkItem[],
): AppointmentPreparationStatus {
  const preparation = items.find(item => item.workKey === appointmentPreparationWorkKey(appointment))
  if (!preparation) return { label: 'No prep task', tone: 'muted' }
  if (preparation.state === 'blocked') return { label: 'Prep blocked', tone: 'warning' }
  if (preparation.state === 'snoozed') return { label: 'Prep snoozed', tone: 'muted' }
  if (preparation.priorityBand <= 1) return { label: 'Prep due today', tone: 'urgent' }
  if (preparation.priorityBand === 2) return { label: 'Prep due soon', tone: 'normal' }
  return { label: 'Prep planned', tone: 'normal' }
}
