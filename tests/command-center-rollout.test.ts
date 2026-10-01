import { describe, expect, it } from 'vitest'
import {
  analyzeWorkGraphRollout,
  calculateCommandCenterRolloutReadiness,
  type WorkGraphReconciliationRun,
} from '@/lib/work/rollout'
import type { WorkGraphReconciliation } from '@/lib/work/reconciliation'
import type { WorkGraphResult, WorkItem } from '@/lib/work/types'

const NOW = new Date('2026-10-01T14:00:00.000Z')

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:one',
    sourceType: 'task',
    sourceIds: ['one'],
    evidence: [],
    record: { type: 'firm', name: 'Firm' },
    title: 'Prepare filing',
    actionLabel: 'Start',
    href: '/admin/tasks',
    owner: 'firm',
    state: 'open',
    priorityBand: 0,
    priorityReasons: [],
    hardDueAt: '2026-09-30T14:00:00.000Z',
    estimateMinutes: 30,
    ...overrides,
  }
}

function reconciliation(overrides: Partial<WorkGraphReconciliation> = {}): WorkGraphReconciliation {
  return {
    legacyCount: 1,
    canonicalCount: 1,
    mappedCount: 1,
    coveragePercent: 100,
    omittedWorkKeys: [],
    duplicateWorkKeys: [],
    differentlyRanked: [],
    additionalCanonicalWorkKeys: [],
    ...overrides,
  }
}

function run(id: string, overrides: Partial<WorkGraphReconciliationRun> = {}): WorkGraphReconciliationRun {
  return {
    id,
    userId: '00000000-0000-4000-8000-000000000001',
    firmDate: '2026-10-01',
    trigger: 'manual',
    generatedAt: NOW.toISOString(),
    durationMs: 500,
    legacyCount: 1,
    canonicalCount: 1,
    mappedCount: 1,
    coveragePercent: 100,
    omittedCount: 0,
    duplicateCount: 0,
    differentlyRankedCount: 0,
    additionalCount: 0,
    criticalCount: 1,
    criticalMisclassifiedCount: 0,
    ownershipViolationCount: 0,
    sourceErrorCodes: [],
    sourceCounts: { task: 1 },
    readinessPassed: true,
    createdAt: NOW.toISOString(),
    ...overrides,
  }
}

describe('command center rollout gate', () => {
  it('passes a clean graph without storing source content in its metrics', () => {
    const graph: WorkGraphResult = {
      generatedAt: NOW.toISOString(),
      items: [item()],
      appointments: [],
      sourceErrors: [],
    }
    const snapshot = analyzeWorkGraphRollout(graph, reconciliation(), 400, NOW)
    expect(snapshot.metrics).toMatchObject({
      coveragePercent: 100,
      criticalMisclassifiedCount: 0,
      ownershipViolationCount: 0,
      readinessPassed: true,
      sourceCounts: { task: 1 },
    })
    expect(JSON.stringify(snapshot.metrics)).not.toContain('Prepare filing')
    expect(JSON.stringify(snapshot.metrics)).not.toContain('task:one')
  })

  it('fails closed for deadline, ownership, source, duplicate, and latency defects', () => {
    const graph: WorkGraphResult = {
      generatedAt: NOW.toISOString(),
      items: [
        item({ priorityBand: 1 }),
        item({ workKey: 'matter:waiting', owner: 'client', priorityBand: 1, hardDueAt: undefined }),
      ],
      appointments: [],
      sourceErrors: ['email'],
    }
    const snapshot = analyzeWorkGraphRollout(
      graph,
      reconciliation({ coveragePercent: 90, duplicateWorkKeys: ['task:one'] }),
      1_501,
      NOW,
    )
    expect(snapshot.metrics).toMatchObject({
      criticalMisclassifiedCount: 1,
      ownershipViolationCount: 1,
      sourceErrorCodes: ['email'],
      readinessPassed: false,
    })
  })

  it('uses the firm date when deciding whether a hard deadline is overdue', () => {
    const graph: WorkGraphResult = {
      generatedAt: NOW.toISOString(),
      items: [item({
        hardDueAt: '2026-10-01T13:00:00.000Z',
        priorityBand: 1,
      })],
      appointments: [],
      sourceErrors: [],
    }

    const snapshot = analyzeWorkGraphRollout(graph, reconciliation(), 400, NOW)
    expect(snapshot.metrics.criticalMisclassifiedCount).toBe(0)
    expect(snapshot.metrics.readinessPassed).toBe(true)
  })

  it('requires three consecutive passing samples and enforces p95 latency', () => {
    expect(calculateCommandCenterRolloutReadiness([run('one'), run('two')]).ready).toBe(false)

    const ready = calculateCommandCenterRolloutReadiness([run('one'), run('two'), run('three')])
    expect(ready).toMatchObject({ ready: true, consecutivePasses: 3, p95DurationMs: 500 })

    const slow = calculateCommandCenterRolloutReadiness([
      run('one', { durationMs: 1_501, readinessPassed: false }),
      run('two'),
      run('three'),
    ])
    expect(slow.ready).toBe(false)
    expect(slow.criteria.find(criterion => criterion.key === 'performance')?.passed).toBe(false)
  })

  it('measures p95 over the latest consecutive clean cohort', () => {
    const readiness = calculateCommandCenterRolloutReadiness([
      run('one', { durationMs: 450 }),
      run('two', { durationMs: 500 }),
      run('three', { durationMs: 550 }),
      run('old-release-failure', { durationMs: 7_723, readinessPassed: false }),
    ])

    expect(readiness).toMatchObject({
      ready: true,
      sampleCount: 4,
      consecutivePasses: 3,
      p95DurationMs: 550,
    })
  })
})
