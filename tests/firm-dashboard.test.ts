import { describe, expect, it } from 'vitest'
import { buildFirmDashboard } from '@/lib/firm/dashboard'
import type { CrmDashboardSnapshot, CrmTotal } from '@/lib/crm/dashboard'
import type { MatterDashboardSnapshot, MatterTotal } from '@/lib/matters/dashboard'
import type { MatterAgingTiles } from '@/lib/queries/pipelineAging'
import type { TaskCounts } from '@/lib/tasks/types'

function matterTotal(count: number, deltaPercent: number | null = null): MatterTotal {
  return {
    count,
    newThisMonth: deltaPercent === null ? 0 : 4,
    newPriorMonth: deltaPercent === null ? 0 : 2,
    deltaPercent,
  }
}

function crmTotal(count: number): CrmTotal {
  return { count, newThisMonth: 0, newPriorMonth: 0, deltaPercent: null }
}

function matters(overrides: Partial<MatterDashboardSnapshot> = {}): MatterDashboardSnapshot {
  return {
    open: matterTotal(12, 100),
    executed: matterTotal(1),
    awaitingIntake: 0,
    needsAttention: 0,
    signingSoon: 0,
    stages: [],
    practiceAreas: [],
    recent: [],
    ...overrides,
  }
}

function crm(overrides: Partial<CrmDashboardSnapshot> = {}): CrmDashboardSnapshot {
  return {
    people: crmTotal(20),
    activePipeline: crmTotal(6),
    converted: crmTotal(4),
    conversion: { percent: 40, converted: 4, total: 10 },
    leadSources: [],
    pipeline: [],
    followUps: { overdue: 0, dueToday: 0, upcoming: 3 },
    recentPeople: [],
    ...overrides,
  }
}

const aging: MatterAgingTiles = { active: 12, red: 0, amber: 0, green: 12, overdue: 0, snoozed: 0 }

const tasks: TaskCounts = { overdue: 2, today: 1, open: 8, mine: 3, team: 4, unassigned: 1 }

describe('firm dashboard', () => {
  it('ranks firm pressure with overdue work first and drops zeros', () => {
    const snapshot = buildFirmDashboard({
      tasks,
      matters: matters({ needsAttention: 3, signingSoon: 1, awaitingIntake: 2 }),
      aging: { ...aging, red: 2, amber: 1 },
      crm: crm({ followUps: { overdue: 4, dueToday: 1, upcoming: 2 } }),
    })

    expect(snapshot.attention.map(item => item.key)).toEqual([
      'overdue-tasks',
      'tasks-today',
      'unassigned-tasks',
      'follow-ups-overdue',
      'follow-ups-today',
      'needs-attention',
      'signing-soon',
      'awaiting-intake',
      'aging-red',
    ])
    expect(snapshot.attention[0]).toMatchObject({ count: 2, href: '/admin/tasks?group=due' })
    expect(snapshot.attention.find(item => item.key === 'aging-red')?.detail).toBe('1 record close to the budget')
  })

  it('treats a failed task read as unavailable rather than a clear queue', () => {
    const snapshot = buildFirmDashboard({
      tasks: null,
      matters: matters(),
      aging,
      crm: crm(),
    })

    expect(snapshot.tasksUnavailable).toBe(true)
    expect(snapshot.attention.map(item => item.key)).toEqual([])
    expect(snapshot.metrics.find(metric => metric.key === 'open-tasks')).toMatchObject({
      value: null,
      caption: 'Task counts are unavailable',
    })
    expect(snapshot.metrics.find(metric => metric.key === 'overdue-tasks')?.value).toBeNull()
    expect(snapshot.metrics.find(metric => metric.key === 'open-matters')?.caption).toBe('+100% from last month')
  })

  it('says the queue is empty only when every pressure count is zero', () => {
    const snapshot = buildFirmDashboard({ tasks: { ...tasks, overdue: 0, today: 0, unassigned: 0 }, matters: matters(), aging, crm: crm() })
    expect(snapshot.attention).toEqual([])
    expect(snapshot.metrics.find(metric => metric.key === 'follow-ups')?.caption).toBe('0 due today · 3 upcoming')
    expect(snapshot.metrics.find(metric => metric.key === 'active-leads')).toMatchObject({
      value: 6,
      href: '/admin/crm/opportunities',
      attention: false,
    })
  })
})
