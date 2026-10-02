import { describe, expect, it } from 'vitest'
import { selectCommittedFocusItem } from '@/lib/work/committedFocus'
import type { DailyPlanPreview, WorkItem } from '@/lib/work/types'

function workItem(workKey: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey,
    sourceType: 'task',
    sourceIds: [workKey],
    evidence: [],
    record: { type: 'firm', name: 'Firm' },
    title: workKey,
    actionLabel: 'Open',
    href: '/admin/tasks',
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [],
    estimateMinutes: 30,
    ...overrides,
  }
}

function preview(items: WorkItem[]): DailyPlanPreview {
  return {
    date: '2026-10-02',
    now: items[0] ?? null,
    mustDo: items,
    suggested: [],
    communication: [],
    waiting: [],
    later: [],
    blocks: [],
    capacityMinutes: 180,
    plannedMinutes: 60,
    criticalMinutes: 0,
    overloadMinutes: 0,
    overload: false,
    appointments: [],
  }
}

describe('committed plan focus', () => {
  it('uses the first executable committed item instead of a fresh live now ranking', () => {
    const liveFirst = workItem('live-first')
    const committedFirst = workItem('committed-first')

    expect(selectCommittedFocusItem(preview([liveFirst, committedFirst]), {
      status: 'committed',
      items: [
        { work_key: 'committed-first', lane: 'must_do', position: 0, status: 'planned' },
        { work_key: 'live-first', lane: 'must_do', position: 1, status: 'planned' },
      ],
    })?.workKey).toBe('committed-first')
  })

  it('skips completed and no-longer-executable commitments in saved order', () => {
    const completed = workItem('completed')
    const blocked = workItem('blocked', { state: 'blocked' })
    const next = workItem('next')

    expect(selectCommittedFocusItem(preview([completed, blocked, next]), {
      status: 'committed',
      items: [
        { work_key: 'completed', lane: 'must_do', position: 0, status: 'completed' },
        { work_key: 'blocked', lane: 'must_do', position: 1, status: 'planned' },
        { work_key: 'next', lane: 'suggested', position: 2, status: 'started' },
      ],
    })?.workKey).toBe('next')
  })

  it('does not replace an exhausted committed plan with new live backlog work', () => {
    const live = workItem('new-live-work')

    expect(selectCommittedFocusItem(preview([live]), {
      status: 'committed',
      items: [{ work_key: 'previously-completed', lane: 'must_do', position: 0, status: 'completed' }],
    })).toBeNull()
  })

  it('uses the deterministic live recommendation before a plan is committed', () => {
    const live = workItem('live-first')

    expect(selectCommittedFocusItem(preview([live]), {
      status: 'draft',
      items: [],
    })?.workKey).toBe('live-first')
  })
})
