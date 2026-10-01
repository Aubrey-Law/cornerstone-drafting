import { describe, expect, it } from 'vitest'
import { addCalendarBusyToToday } from '@/lib/work/calendarBusy'
import type { TodayData } from '@/lib/queries/today'

function today(): TodayData {
  return {
    atRisk: [], waitingOnYou: [], waitingOnClient: [], snoozed: [], unreadThreads: [],
    intakeReview: [], intakeToSend: [], overdueTasks: [], tasksDueToday: [],
    activeMatterCount: 0, needsYou: 0, overdueCount: 0, overdueMatterCount: 0, overdueLeadCount: 0,
    appointmentsToday: [{
      id: 'appointment:a1', matter_id: 'm1', client_name: 'Client',
      next_appointment: '2026-09-30T14:00:00.000Z', end_at: '2026-09-30T15:00:00.000Z',
      next_appointment_type: 'Consultation', href: '/admin/matters/m1', is_all_day: false,
    }],
    billing: { unbilledCount: 0, unbilledCents: 0, overdueInvoices: [], overdueCents: 0 },
  }
}

describe('work-graph calendar availability', () => {
  it('keeps native appointment context and adds only non-overlapping busy intervals', () => {
    const merged = addCalendarBusyToToday(today(), [
      { start: Date.parse('2026-09-30T14:00:00.000Z'), end: Date.parse('2026-09-30T15:00:00.000Z') },
      { start: Date.parse('2026-09-30T16:00:00.000Z'), end: Date.parse('2026-09-30T17:30:00.000Z') },
    ])

    expect(merged.appointmentsToday).toHaveLength(2)
    expect(merged.appointmentsToday[0]?.id).toBe('appointment:a1')
    expect(merged.appointmentsToday[1]).toMatchObject({
      id: 'calendar-busy:2026-09-30T16:00:00.000Z:2026-09-30T17:30:00.000Z',
      end_at: '2026-09-30T17:30:00.000Z',
    })
  })

  it('preserves the portions of a longer busy block outside a native appointment', () => {
    const merged = addCalendarBusyToToday(today(), [{
      start: Date.parse('2026-09-30T13:00:00.000Z'),
      end: Date.parse('2026-09-30T16:00:00.000Z'),
    }])

    expect(merged.appointmentsToday.map(appointment => [
      appointment.next_appointment,
      appointment.end_at,
    ])).toEqual([
      ['2026-09-30T13:00:00.000Z', '2026-09-30T14:00:00.000Z'],
      ['2026-09-30T14:00:00.000Z', '2026-09-30T15:00:00.000Z'],
      ['2026-09-30T15:00:00.000Z', '2026-09-30T16:00:00.000Z'],
    ])
  })
})
