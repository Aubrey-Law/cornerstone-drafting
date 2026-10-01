import type { Interval } from '@/lib/appointments/types'
import type { TodayAppointment, TodayData } from '@/lib/queries/today'

/**
 * Calendar availability is scheduling evidence, not an obligation. Keep it in
 * the planner's busy rail without turning a personal calendar event into a
 * "prepare" task. Native appointments win so their matter context remains.
 */
export function addCalendarBusyToToday(today: TodayData, busy: Interval[]): TodayData {
  const nativeBusy = today.appointmentsToday.map(appointment => {
    const start = Date.parse(appointment.next_appointment)
    const parsedEnd = appointment.end_at ? Date.parse(appointment.end_at) : NaN
    return {
      start,
      end: Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + 60 * 60_000,
    }
  }).filter(interval => Number.isFinite(interval.start))

  const calendarOnly: TodayAppointment[] = busy
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .flatMap(interval => nativeBusy.reduce<Interval[]>((segments, native) => (
      segments.flatMap(segment => {
        if (segment.start >= native.end || segment.end <= native.start) return [segment]
        return [
          ...(segment.start < native.start ? [{ start: segment.start, end: native.start }] : []),
          ...(segment.end > native.end ? [{ start: native.end, end: segment.end }] : []),
        ]
      })
    ), [interval]))
    .map(interval => ({
      id: `calendar-busy:${new Date(interval.start).toISOString()}:${new Date(interval.end).toISOString()}`,
      matter_id: null,
      client_name: null,
      next_appointment: new Date(interval.start).toISOString(),
      end_at: new Date(interval.end).toISOString(),
      next_appointment_type: 'Calendar commitment',
      href: '/admin/calendar',
      is_all_day: false,
    }))

  return {
    ...today,
    appointmentsToday: [...today.appointmentsToday, ...calendarOnly]
      .sort((left, right) => left.next_appointment.localeCompare(right.next_appointment)),
  }
}
