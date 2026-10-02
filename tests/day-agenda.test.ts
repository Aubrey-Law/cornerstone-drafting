import { describe, expect, it } from 'vitest'
import { buildDayAgenda } from '@/lib/work/dayAgenda'
import type { TodayAppointment } from '@/lib/queries/today'
import type { WorkItem } from '@/lib/work/types'

const appointment: TodayAppointment = {
  id: 'appointment:consultation-1', matter_id: 'matter-1', client_name: 'Jordan Client',
  next_appointment: '2026-10-02T14:00:00.000Z', end_at: '2026-10-02T15:00:00.000Z',
  next_appointment_type: 'Initial consultation', href: '/admin/matters/matter-1', is_all_day: false,
}

const work: WorkItem = {
  workKey: 'task:follow-up', sourceType: 'task', sourceIds: ['follow-up'], evidence: [],
  record: { type: 'matter', id: 'matter-1', name: 'Jordan Client' }, title: 'Call Jordan Client', actionLabel: 'Open',
  href: '/admin/matters/matter-1?tab=tasks', owner: 'firm', state: 'open', priorityBand: 1, priorityReasons: [], estimateMinutes: 15,
}

describe('day agenda', () => {
  it('interleaves appointments and planned work chronologically', () => {
    const agenda = buildDayAgenda({
      appointments: [appointment],
      blocks: [
        { workKey: 'task:follow-up', startAt: '2026-10-02T13:00:00.000Z', endAt: '2026-10-02T13:15:00.000Z', minutes: 15 },
        { workKey: 'batch:communications', startAt: '2026-10-02T15:10:00.000Z', endAt: '2026-10-02T15:40:00.000Z', minutes: 30 },
      ],
      items: [work],
    })

    expect(agenda.map(entry => [entry.kind, entry.title])).toEqual([
      ['work', 'Call Jordan Client'],
      ['appointment', 'Jordan Client'],
      ['work', 'Communication batch'],
    ])
    expect(agenda[0]).toMatchObject({ timeLabel: '9:00 AM–9:15 AM', durationLabel: '15 min' })
    expect(agenda[1]).toMatchObject({ timeLabel: '10:00 AM–11:00 AM', preparation: { label: 'No prep task', tone: 'muted' } })
    expect(agenda[2]).toMatchObject({ href: '/admin/communications', durationLabel: '30 min' })
  })

  it('places an appointment before work at the same time', () => {
    const agenda = buildDayAgenda({
      appointments: [appointment],
      blocks: [{ workKey: 'task:follow-up', startAt: appointment.next_appointment, endAt: appointment.end_at!, minutes: 15 }],
      items: [work],
    })

    expect(agenda.map(entry => entry.kind)).toEqual(['appointment', 'work'])
  })
})
