import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  desiredDailyPlanBlocks,
  summarizeDailyPlanCalendar,
} from '@/lib/work/dailyPlanCalendar'
import type { StoredDailyPlan, StoredDailyPlanItem } from '@/lib/work/plans'
import type { WorkItem } from '@/lib/work/types'

function row(overrides: Partial<StoredDailyPlanItem> = {}): StoredDailyPlanItem {
  return {
    id: 'item-1',
    plan_id: '11111111-1111-4111-8111-111111111111',
    work_key: 'task:1',
    source_type: 'task',
    record_type: 'matter',
    record_id: '22222222-2222-4222-8222-222222222222',
    lane: 'must_do',
    position: 0,
    estimate_minutes: 30,
    priority_band: 1,
    reason_codes: ['due_today'],
    block_start: '2026-10-01T14:00:00.000Z',
    block_end: '2026-10-01T14:30:00.000Z',
    status: 'planned',
    completed_at: null,
    ...overrides,
  }
}

function plan(items: StoredDailyPlanItem[]): StoredDailyPlan {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '33333333-3333-4333-8333-333333333333',
    plan_date: '2026-10-01',
    status: 'committed',
    capacity_minutes: 192,
    planned_minutes: 60,
    interruption_buffer_percent: 20,
    generated_at: '2026-10-01T12:00:00.000Z',
    committed_at: '2026-10-01T12:01:00.000Z',
    closed_at: null,
    items,
  }
}

function work(workKey = 'task:1'): WorkItem {
  return {
    workKey,
    sourceType: 'task',
    sourceIds: ['1'],
    evidence: [],
    record: { type: 'matter', id: '22222222-2222-4222-8222-222222222222', name: 'Estate plan' },
    title: 'Prepare signing packet',
    actionLabel: 'Start',
    href: '/admin/tasks',
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [{ code: 'due_today', label: 'Due today' }],
    estimateMinutes: 30,
  }
}

describe('daily plan calendar model', () => {
  it('reserves executable plan rows and collapses the stored communication batch safely', () => {
    const subject = plan([
      row(),
      row({ id: 'item-2', work_key: 'email:1', source_type: 'email', lane: 'communication', position: 1 }),
      row({ id: 'item-3', work_key: 'task:later', lane: 'later', position: 2 }),
      row({ id: 'item-4', work_key: 'task:skipped', position: 3, status: 'skipped' }),
      row({ id: 'item-5', work_key: 'task:done', position: 4, status: 'completed' }),
    ])

    const desired = desiredDailyPlanBlocks(subject, [work(), work('task:done')])

    expect(desired.map(block => block.workKey)).toEqual(['task:1', 'email:1', 'task:done'])
    expect(desired.find(block => block.workKey === 'email:1')?.title).toBe('Communication batch')
    expect(desired.find(block => block.workKey === 'task:done')?.title).toBe('Prepare signing packet')
  })

  it('distinguishes synced, pending, and stale future holds', () => {
    const second = row({
      id: 'item-2',
      work_key: 'task:2',
      position: 1,
      block_start: '2026-10-01T15:00:00.000Z',
      block_end: '2026-10-01T15:30:00.000Z',
    })
    const subject = plan([row(), second])
    const desired = desiredDailyPlanBlocks(subject, [work(), work('task:2')])
    const metadata = (workKey: string, pending = false) => ({
      source: 'daily_plan_hold',
      dailyPlanId: subject.id,
      workKey,
      calendarSyncPending: pending,
    })

    const status = summarizeDailyPlanCalendar(subject, desired, [
      {
        id: 'appointment-1', start_time: '2026-10-01T14:00:00.000Z', end_time: '2026-10-01T14:30:00.000Z',
        google_event_id: 'google-1', attendee_name: 'Plan block: One', status: 'scheduled', raw: metadata('task:1'),
      },
      {
        id: 'appointment-2', start_time: '2026-10-01T15:00:00.000Z', end_time: '2026-10-01T15:30:00.000Z',
        google_event_id: null, attendee_name: 'Plan block: Two', status: 'scheduled', raw: metadata('task:2', true),
      },
      {
        id: 'appointment-old', start_time: '2026-10-01T16:00:00.000Z', end_time: '2026-10-01T16:30:00.000Z',
        google_event_id: 'google-old', attendee_name: 'Plan block: Old', status: 'scheduled', raw: metadata('task:old'),
      },
    ], new Date('2026-10-01T13:00:00.000Z'))

    expect(status).toEqual({ desiredBlocks: 2, syncedBlocks: 1, pendingBlocks: 1, staleBlocks: 1 })
  })
})
