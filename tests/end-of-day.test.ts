import { describe, expect, it } from 'vitest'
import { buildEndOfDayClosePreview } from '@/lib/work/endOfDay'
import type { StoredDailyPlan } from '@/lib/work/plans'
import type { WorkItem } from '@/lib/work/types'

function work(workKey: string, priorityBand: WorkItem['priorityBand'], state: WorkItem['state'] = 'open'): WorkItem {
  return {
    workKey,
    sourceType: 'task',
    sourceIds: [workKey],
    evidence: [],
    record: { type: 'firm', name: 'Firm' },
    title: workKey,
    actionLabel: 'Open',
    href: `/admin/tasks?work=${workKey}`,
    owner: 'firm',
    state,
    priorityBand,
    priorityReasons: [],
    estimateMinutes: 30,
  }
}

function plan(): StoredDailyPlan {
  return {
    id: 'plan-1', user_id: 'user-1', plan_date: '2026-10-01', status: 'committed',
    capacity_minutes: 180, planned_minutes: 120, interruption_buffer_percent: 20,
    generated_at: '2026-10-01T12:00:00.000Z', committed_at: '2026-10-01T12:05:00.000Z', closed_at: null,
    items: [
      { id: '1', plan_id: 'plan-1', work_key: 'done', source_type: 'task', record_type: 'firm', record_id: null, lane: 'must_do', position: 0, estimate_minutes: 30, priority_band: 1, reason_codes: [], block_start: null, block_end: null, status: 'completed', completed_at: '2026-10-01T14:00:00.000Z' },
      { id: '2', plan_id: 'plan-1', work_key: 'blocked', source_type: 'task', record_type: 'firm', record_id: null, lane: 'must_do', position: 1, estimate_minutes: 30, priority_band: 1, reason_codes: [], block_start: null, block_end: null, status: 'started', completed_at: null },
      { id: '3', plan_id: 'plan-1', work_key: 'snoozed', source_type: 'task', record_type: 'firm', record_id: null, lane: 'suggested', position: 2, estimate_minutes: 30, priority_band: 2, reason_codes: [], block_start: null, block_end: null, status: 'planned', completed_at: null },
      { id: '4', plan_id: 'plan-1', work_key: 'unfinished', source_type: 'task', record_type: 'firm', record_id: null, lane: 'later', position: 3, estimate_minutes: 30, priority_band: 2, reason_codes: [], block_start: null, block_end: null, status: 'planned', completed_at: null },
    ],
  }
}

describe('end-of-day close preview', () => {
  it('does not treat interrupted work as completed and preserves it in the review', () => {
    const unfinished = { ...work('unfinished', 2), dueAt: '2026-10-04T15:00:00.000Z' }
    const preview = buildEndOfDayClosePreview(plan(), [
      work('done', 1), work('blocked', 1, 'blocked'), work('snoozed', 2, 'snoozed'), unfinished,
    ])

    expect(preview.completed.map(item => item.workKey)).toEqual(['done'])
    expect(preview.blocked.map(item => item.workKey)).toEqual(['blocked'])
    expect(preview.snoozed.map(item => item.workKey)).toEqual(['snoozed'])
    expect(preview.interrupted.map(item => item.workKey)).toEqual(['unfinished'])
    expect(preview.interrupted[0]?.dueAt).toBe('2026-10-04T15:00:00.000Z')
  })

  it('limits newly surfaced critical work and unresolved risks while choosing a deterministic first action', () => {
    const preview = buildEndOfDayClosePreview(plan(), [
      work('unfinished', 2), work('critical-c', 0), work('critical-a', 0), work('critical-b', 0), work('critical-d', 0), work('must-do', 1),
    ])

    expect(preview.newCritical.map(item => item.workKey)).toEqual(['critical-a', 'critical-b', 'critical-c'])
    expect(preview.unresolvedRisks.map(item => item.workKey)).toEqual(['critical-a', 'critical-b', 'critical-c'])
    expect(preview.tomorrowFirstAction?.workKey).toBe('critical-a')
  })
})
