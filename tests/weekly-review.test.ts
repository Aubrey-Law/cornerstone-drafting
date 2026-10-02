import { describe, expect, it } from 'vitest'
import { buildWeeklyReview, weeklyReviewStart } from '@/lib/work/weeklyReview'
import { DEFAULT_WORK_PREFERENCES, type WorkItem } from '@/lib/work/types'

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:1', sourceType: 'task', sourceIds: ['1'], evidence: [],
    record: { type: 'firm', name: 'Firm' }, title: 'Review file', actionLabel: 'Open', href: '/admin/tasks',
    owner: 'firm', state: 'open', priorityBand: 1, priorityReasons: [{ code: 'due_soon', label: 'Due soon' }], estimateMinutes: 60,
    ...overrides,
  }
}

describe('weekly review', () => {
  const friday = new Date('2026-10-02T14:00:00Z')

  it('starts with the upcoming Monday and keeps dated work on its due day', () => {
    expect(weeklyReviewStart(friday)).toBe('2026-10-05')
    const review = buildWeeklyReview({
      now: friday,
      preferences: DEFAULT_WORK_PREFERENCES,
      items: [item({ dueAt: '2026-10-07T17:00:00Z' })],
    })
    expect(review.days[2].items.map(value => value.workKey)).toEqual(['task:1'])
    expect(review.days[0].items).toEqual([])
  })

  it('places overdue work on Monday, leaves undated priority work flexible, and excludes waiting work', () => {
    const review = buildWeeklyReview({
      now: friday,
      preferences: { ...DEFAULT_WORK_PREFERENCES, focusCapacityMinutes: 60, interruptionBufferPercent: 0 },
      items: [
        item({ workKey: 'overdue', dueAt: '2026-10-01T17:00:00Z', estimateMinutes: 90 }),
        item({ workKey: 'flexible', dueAt: undefined }),
        item({ workKey: 'waiting', owner: 'client', state: 'waiting', priorityBand: 4 }),
      ],
    })
    expect(review.days[0].items.map(value => value.workKey)).toEqual(['overdue'])
    expect(review.days[0].overflowMinutes).toBe(30)
    expect(review.flexible.map(value => value.workKey)).toEqual(['flexible'])
    expect(review.waiting.map(value => value.workKey)).toEqual(['waiting'])
  })
})
