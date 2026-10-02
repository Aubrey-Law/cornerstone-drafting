import { describe, expect, it } from 'vitest'
import { buildCommittedDayAgenda, buildDayAgenda } from '@/lib/work/dayAgenda'
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

  it('uses only saved committed blocks, their windows, and their statuses', () => {
    const laterWork = { ...work, workKey: 'task:later', title: 'Draft review memo' }
    const newlyRanked = { ...work, workKey: 'task:new', title: 'Newly ranked work' }
    const agenda = buildCommittedDayAgenda({
      appointments: [appointment],
      items: [work, laterWork, newlyRanked],
      planItems: [
        { work_key: 'task:later', lane: 'must_do', position: 0, status: 'started', block_start: '2026-10-02T13:00:00.000Z', block_end: '2026-10-02T13:30:00.000Z', estimate_minutes: 30 },
        { work_key: 'task:follow-up', lane: 'suggested', position: 1, status: 'completed', block_start: '2026-10-02T15:10:00.000Z', block_end: '2026-10-02T15:25:00.000Z', estimate_minutes: 15 },
        { work_key: 'task:new', lane: 'must_do', position: 2, status: 'skipped', block_start: null, block_end: null, estimate_minutes: 30 },
      ],
    })

    expect(agenda.map(entry => entry.title)).toEqual(['Draft review memo', 'Jordan Client', 'Call Jordan Client'])
    expect(agenda.map(entry => entry.workStatus).filter(Boolean)).toEqual(['started', 'completed'])
    expect(agenda.some(entry => entry.title === 'Newly ranked work')).toBe(false)
  })
})
