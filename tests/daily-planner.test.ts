import { describe, expect, it } from 'vitest'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { itemsExceptNow } from '@/lib/work/presentation'
import { DEFAULT_WORK_PREFERENCES, type WorkItem } from '@/lib/work/types'

const NOW = new Date('2026-09-30T13:00:00.000Z')

function item(key: string, band: WorkItem['priorityBand'], minutes = 30, sourceType: WorkItem['sourceType'] = 'task'): WorkItem {
  return {
    workKey: key, sourceType, sourceIds: [key], evidence: [], record: { type: 'firm', name: 'Firm' },
    title: key, actionLabel: 'Open', href: '/admin/tasks', owner: 'firm', state: 'open',
    priorityBand: band, priorityReasons: [], estimateMinutes: minutes,
    ...(sourceType === 'email' ? { batchTag: 'communications' } : {}),
  }
}

describe('daily planner', () => {
  it('limits ordinary must-dos to three but never hides critical overflow', () => {
    const normal = createDailyPlanPreview({
      items: [item('one', 1), item('two', 1), item('three', 1), item('four', 1)],
      preferences: DEFAULT_WORK_PREFERENCES, now: NOW,
    })
    expect(normal.mustDo.map(value => value.workKey)).toEqual(['one', 'two', 'three'])

    const critical = createDailyPlanPreview({
      items: [item('one', 0), item('two', 0), item('three', 0), item('four', 0)],
      preferences: DEFAULT_WORK_PREFERENCES, now: NOW,
    })
    expect(critical.mustDo).toHaveLength(4)
  })

  it('reserves the interruption buffer and reports overload instead of hiding work', () => {
    const preview = createDailyPlanPreview({
      items: [item('critical-a', 0, 120), item('critical-b', 0, 120)],
      preferences: DEFAULT_WORK_PREFERENCES, now: NOW,
    })
    expect(preview.capacityMinutes).toBe(192)
    expect(preview.overload).toBe(true)
    expect(preview.overloadMinutes).toBe(48)
  })

  it('groups non-must-do replies into the communication batch', () => {
    const preview = createDailyPlanPreview({
      items: [item('must', 1), item('mail', 2, 10, 'email')],
      preferences: DEFAULT_WORK_PREFERENCES, now: NOW,
    })
    expect(preview.mustDo.map(value => value.workKey)).toEqual(['must'])
    expect(preview.communication.map(value => value.workKey)).toEqual(['mail'])
  })

  it('excludes waiting work from Focus Mode', () => {
    const waiting = { ...item('waiting', 4), owner: 'client' as const, state: 'waiting' as const }
    const preview = createDailyPlanPreview({ items: [waiting], preferences: DEFAULT_WORK_PREFERENCES, now: NOW })
    expect(preview.now).toBeNull()
    expect(preview.waiting).toHaveLength(1)
  })

  it('renders the Now obligation only once across the visible lanes', () => {
    const now = item('next', 1)
    expect(itemsExceptNow([now, item('after', 1)], now).map(value => value.workKey))
      .toEqual(['after'])
  })
})
