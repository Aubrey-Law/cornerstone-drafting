import { describe, expect, it } from 'vitest'
import { taskFixture } from './fixtures/task'
import { buildTaskWorkSummaries, compareTasksByWorkSummary } from '@/lib/work/taskSummary'
import { compareTasks } from '@/lib/tasks/types'
import type { WorkItem } from '@/lib/work/types'

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:task-1',
    sourceType: 'task',
    sourceIds: ['task-1'],
    evidence: [{ sourceType: 'task', sourceId: 'task-1', href: '/admin/tasks' }],
    record: { type: 'firm', name: 'Firm' },
    title: 'Call client',
    actionLabel: 'Start task',
    href: '/admin/tasks',
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [{ code: 'due_today', label: 'Due today' }],
    estimateMinutes: 10,
    ...overrides,
  }
}

describe('task work summaries', () => {
  it('indexes canonical priority and explanations by task id', () => {
    expect(buildTaskWorkSummaries([item()])['task-1']).toMatchObject({
      workKey: 'task:task-1',
      priorityBand: 1,
      priorityReasons: [{ code: 'due_today', label: 'Due today' }],
      position: 0,
    })
  })

  it('retains task evidence when another source wins deduplication', () => {
    const summaries = buildTaskWorkSummaries([item({
      workKey: 'matter:matter-1:send-intake',
      sourceType: 'matter_action',
      sourceIds: ['matter-1'],
      evidence: [{ sourceType: 'task', sourceId: 'task-2', href: '/admin/tasks' }],
      priorityBand: 0,
    })])

    expect(summaries['task-2']?.priorityBand).toBe(0)
  })

  it('sorts ranked tasks first and preserves the ordinary fallback order', () => {
    const first = taskFixture({ id: 'task-1', due_at: '2026-10-03T12:00:00Z' })
    const second = taskFixture({ id: 'task-2', due_at: '2026-10-01T12:00:00Z' })
    const unranked = taskFixture({ id: 'task-3', due_at: '2026-10-02T12:00:00Z' })
    const summaries = buildTaskWorkSummaries([
      item({ workKey: 'task:task-1', sourceIds: ['task-1'], evidence: [], priorityBand: 0 }),
      item({ workKey: 'task:task-2', sourceIds: ['task-2'], evidence: [], priorityBand: 1 }),
    ])

    expect([unranked, second, first].sort(compareTasksByWorkSummary(summaries, compareTasks)).map(task => task.id))
      .toEqual(['task-1', 'task-2', 'task-3'])
  })
})
