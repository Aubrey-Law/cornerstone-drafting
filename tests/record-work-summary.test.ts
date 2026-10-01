import { describe, expect, it } from 'vitest'
import {
  attentionRecordIds,
  buildRecordWorkSummaries,
  isRecordAttentionItem,
} from '@/lib/work/recordSummary'
import type { WorkItem } from '@/lib/work/types'

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:1', sourceType: 'task', sourceIds: ['1'], evidence: [],
    record: { type: 'matter', id: 'matter-1', name: 'Client' },
    title: 'Prepare documents', actionLabel: 'Start task', href: '/admin/tasks',
    owner: 'firm', state: 'open', priorityBand: 1,
    priorityReasons: [{ code: 'due_today', label: 'Due today' }],
    estimateMinutes: 30,
    ...overrides,
  }
}

describe('record work summaries', () => {
  it('uses the highest-ranked executable obligation and preserves two reasons', () => {
    const summaries = buildRecordWorkSummaries([
      item({ workKey: 'task:later', priorityBand: 2, title: 'Later' }),
      item({
        workKey: 'task:critical', priorityBand: 0, title: 'Critical',
        priorityReasons: [
          { code: 'hard_deadline_overdue', label: 'Hard deadline overdue' },
          { code: 'client_waiting', label: 'Client is waiting' },
          { code: 'high_priority', label: 'High priority' },
        ],
      }),
    ])

    expect(summaries['matter-1']).toMatchObject({
      workKey: 'task:critical', title: 'Critical', itemCount: 2, attentionCount: 2,
    })
    expect(summaries['matter-1'].priorityReasons).toHaveLength(2)
  })

  it('shows client-owned work without calling it firm attention', () => {
    const waiting = item({ owner: 'client', state: 'waiting', priorityBand: 4 })
    expect(isRecordAttentionItem(waiting)).toBe(false)
    expect(buildRecordWorkSummaries([waiting])['matter-1']).toMatchObject({
      owner: 'client', state: 'waiting', attentionCount: 0,
    })
  })

  it('returns attention ids in canonical band order and excludes planned work', () => {
    const summaries = buildRecordWorkSummaries([
      item({ record: { type: 'lead', id: 'soon', name: 'Soon' }, priorityBand: 2, workKey: 'task:soon' }),
      item({ record: { type: 'lead', id: 'critical', name: 'Critical' }, priorityBand: 0, workKey: 'task:critical' }),
      item({ record: { type: 'lead', id: 'planned', name: 'Planned' }, priorityBand: 3, workKey: 'task:planned' }),
    ], 'lead')

    expect(attentionRecordIds(summaries)).toEqual(['critical', 'soon'])
  })
})
