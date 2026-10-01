import { describe, expect, it } from 'vitest'
import { buildCalendarTodayPlan } from '@/lib/work/calendarPlan'
import type { StoredDailyPlan } from '@/lib/work/plans'
import type { DailyPlanPreview, WorkItem } from '@/lib/work/types'

function item(workKey: string, title: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey, sourceType: 'task', sourceIds: [workKey], evidence: [],
    record: { type: 'firm', name: 'Firm' }, title, actionLabel: 'Start', href: '/admin/tasks',
    owner: 'firm', state: 'open', priorityBand: 1,
    priorityReasons: [{ code: 'due_today', label: 'Due today' }], estimateMinutes: 30,
    ...overrides,
  }
}

function preview(items: WorkItem[]): DailyPlanPreview {
  return {
    date: '2026-10-01', now: items[0] ?? null, mustDo: items, suggested: [], communication: [],
    waiting: [], later: [], blocks: items.map((entry, index) => ({
      workKey: entry.workKey,
      startAt: `2026-10-01T1${index}:00:00.000Z`,
      endAt: `2026-10-01T1${index}:30:00.000Z`,
      minutes: 30,
    })),
    capacityMinutes: 192, plannedMinutes: items.length * 30, criticalMinutes: 0,
    overloadMinutes: 0, overload: false, appointments: [],
  }
}

describe('calendar daily plan presentation', () => {
  it('shows deterministic preview blocks when no plan has been saved', () => {
    const work = item('task:1', 'Prepare documents')
    const result = buildCalendarTodayPlan({ items: [work], preview: preview([work]), stored: null })
    expect(result).toMatchObject({ status: 'uncommitted', plannedMinutes: 30 })
    expect(result.items[0]).toMatchObject({
      workKey: 'task:1', title: 'Prepare documents', blockStart: '2026-10-01T10:00:00.000Z',
    })
  })

  it('uses the committed order and blocks instead of silently replanning', () => {
    const first = item('task:1', 'First')
    const second = item('task:2', 'Second')
    const stored: StoredDailyPlan = {
      id: 'plan-1', user_id: 'user-1', plan_date: '2026-10-01', status: 'committed',
      capacity_minutes: 192, planned_minutes: 60, interruption_buffer_percent: 20,
      generated_at: '2026-10-01T12:00:00Z', committed_at: '2026-10-01T12:01:00Z', closed_at: null,
      items: [
        { id: '2', plan_id: 'plan-1', work_key: 'task:2', source_type: 'task', record_type: 'firm', record_id: null, lane: 'must_do', position: 0, estimate_minutes: 30, priority_band: 1, reason_codes: ['due_today'], block_start: '2026-10-01T13:00:00Z', block_end: '2026-10-01T13:30:00Z', status: 'started', completed_at: null },
        { id: '1', plan_id: 'plan-1', work_key: 'task:1', source_type: 'task', record_type: 'firm', record_id: null, lane: 'must_do', position: 1, estimate_minutes: 30, priority_band: 1, reason_codes: ['due_today'], block_start: '2026-10-01T14:00:00Z', block_end: '2026-10-01T14:30:00Z', status: 'planned', completed_at: null },
      ],
    }

    const result = buildCalendarTodayPlan({ items: [first, second], preview: preview([first, second]), stored })
    expect(result.items.map(entry => entry.workKey)).toEqual(['task:2', 'task:1'])
    expect(result.items[0]).toMatchObject({ itemStatus: 'started', blockStart: '2026-10-01T13:00:00Z' })
  })

  it('collapses individual replies into one communication batch', () => {
    const reply = item('email:1', 'Reply to client', { sourceType: 'email', estimateMinutes: 10 })
    const draft = preview([])
    draft.communication = [reply]
    draft.plannedMinutes = 10
    draft.blocks = [{ workKey: 'batch:communications', startAt: '2026-10-01T15:00:00Z', endAt: '2026-10-01T15:10:00Z', minutes: 10 }]

    const result = buildCalendarTodayPlan({ items: [reply], preview: draft, stored: null })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ workKey: 'batch:communications', itemCount: 1 })
  })
})
