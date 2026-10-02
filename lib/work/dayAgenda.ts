import {
  formatAppointmentTime,
  formatSuggestedBlockTime,
  getAppointmentPreparationStatus,
  type AppointmentPreparationStatus,
} from '@/lib/work/appointmentPresentation'
import type { TodayAppointment } from '@/lib/queries/today'
import type { SuggestedBlock, WorkItem } from '@/lib/work/types'

export type DayAgendaEntry = {
  key: string
  kind: 'appointment' | 'work'
  startsAt: string
  timeLabel: string
  title: string
  detail?: string
  href: string
  durationLabel?: string
  preparation?: AppointmentPreparationStatus
}

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * A single, chronological presentation of the constraints and commitments
 * that form today's realistic plan. It deliberately does not create work or
 * alter ranking; it only combines already-selected blocks and calendar facts.
 */
export function buildDayAgenda(input: {
  appointments: TodayAppointment[]
  blocks: SuggestedBlock[]
  items: WorkItem[]
}): DayAgendaEntry[] {
  const workByKey = new Map(input.items.map(item => [item.workKey, item]))
  const appointments = input.appointments.map(appointment => ({
    key: `appointment:${appointment.id}`,
    kind: 'appointment' as const,
    startsAt: appointment.next_appointment,
    timeLabel: formatAppointmentTime(appointment),
    title: appointment.client_name ?? appointment.next_appointment_type ?? 'Appointment',
    detail: appointment.client_name && appointment.next_appointment_type
      ? appointment.next_appointment_type
      : undefined,
    href: appointment.href,
    preparation: getAppointmentPreparationStatus(appointment, input.items),
  }))
  const work = input.blocks.map(block => {
    const item = workByKey.get(block.workKey)
    return {
      key: `work:${block.workKey}`,
      kind: 'work' as const,
      startsAt: block.startAt,
      timeLabel: formatSuggestedBlockTime(block),
      title: item?.title ?? 'Communication batch',
      href: item?.href ?? '/admin/communications',
      durationLabel: durationLabel(block.minutes),
    }
  })

  return [...appointments, ...work].sort((left, right) => {
    const byStart = Date.parse(left.startsAt) - Date.parse(right.startsAt)
    if (Number.isFinite(byStart) && byStart !== 0) return byStart
    if (!Number.isFinite(byStart)) return left.startsAt.localeCompare(right.startsAt)
    // Preserve hard commitments before flexible work when the times match.
    if (left.kind !== right.kind) return left.kind === 'appointment' ? -1 : 1
    return left.key.localeCompare(right.key)
  })
}
