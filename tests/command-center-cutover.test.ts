import { describe, expect, it } from 'vitest'
import {
  calculateCommandCenterCutoverReadiness,
  type CommandCenterUsageDay,
} from '@/lib/work/cutover'
import type { WorkGraphReconciliationRun } from '@/lib/work/rollout'

const USER_ID = '00000000-0000-4000-8000-000000000001'

function run(firmDate: string, overrides: Partial<WorkGraphReconciliationRun> = {}): WorkGraphReconciliationRun {
  return {
    id: `run-${firmDate}`,
    userId: USER_ID,
    firmDate,
    trigger: 'cron',
    generatedAt: `${firmDate}T12:00:00.000Z`,
    durationMs: 500,
    legacyCount: 20,
    canonicalCount: 20,
    mappedCount: 20,
    coveragePercent: 100,
    omittedCount: 0,
    duplicateCount: 0,
    differentlyRankedCount: 0,
    additionalCount: 0,
    criticalCount: 1,
    criticalMisclassifiedCount: 0,
    ownershipViolationCount: 0,
    sourceErrorCodes: [],
    sourceCounts: { task: 20 },
    readinessPassed: true,
    createdAt: `${firmDate}T12:00:00.000Z`,
    ...overrides,
  }
}

function usage(firmDate: string, overrides: Partial<CommandCenterUsageDay> = {}): CommandCenterUsageDay {
  return {
    userId: USER_ID,
    firmDate,
    commandCenterOpenCount: 1,
    legacyTodayOpenCount: 0,
    planGeneratedCount: 1,
    planReplannedCount: 0,
    planCommittedCount: 1,
    planClosedCount: 0,
    workStartedCount: 3,
    workCompletedCount: 2,
    workSnoozedCount: 0,
    workBlockedCount: 0,
    planningSeconds: 90,
    firstChoiceSeconds: 8,
    firstOpenedAt: `${firmDate}T12:00:00.000Z`,
    lastEventAt: `${firmDate}T17:00:00.000Z`,
    ...overrides,
  }
}

const TEN_BUSINESS_DAYS = [
  '2026-10-01', '2026-10-02',
  '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
  '2026-10-12', '2026-10-13', '2026-10-14',
]

describe('command center final cutover gate', () => {
  it('passes only after ten clean used business days and both speed targets', () => {
    const result = calculateCommandCenterCutoverReadiness({
      enabledAt: '2026-10-01T04:30:00.000Z',
      cutoverAt: null,
      runs: TEN_BUSINESS_DAYS.map(date => run(date)).reverse(),
      usage: TEN_BUSINESS_DAYS.map(date => usage(date)),
    })

    expect(result).toMatchObject({
      ready: true,
      cutoverComplete: false,
      parallelBusinessDays: 10,
      medianPlanningSeconds: 90,
      medianChoiceSeconds: 8,
      completionRatePercent: 66.67,
    })
    expect(result.criteria.every(criterion => criterion.passed)).toBe(true)
  })

  it('does not count weekends, unused days, or failed reconciliation days', () => {
    const dates = [...TEN_BUSINESS_DAYS, '2026-10-03', '2026-10-04']
    const runs = dates.map(date => run(date))
    const usageRows = dates.map(date => usage(date))
    usageRows[0] = usage(TEN_BUSINESS_DAYS[0], { commandCenterOpenCount: 0 })
    runs[1] = run(TEN_BUSINESS_DAYS[1], { readinessPassed: false, duplicateCount: 1 })

    const result = calculateCommandCenterCutoverReadiness({
      enabledAt: '2026-10-01T12:00:00.000Z',
      cutoverAt: null,
      runs,
      usage: usageRows,
    })

    expect(result.parallelBusinessDays).toBe(8)
    expect(result.ready).toBe(false)
    expect(result.criteria.find(criterion => criterion.key === 'parallel_days')?.passed).toBe(false)
  })

  it('fails closed when median planning or choice time exceeds its target', () => {
    const result = calculateCommandCenterCutoverReadiness({
      enabledAt: '2026-10-01T12:00:00.000Z',
      cutoverAt: null,
      runs: TEN_BUSINESS_DAYS.map(date => run(date)),
      usage: TEN_BUSINESS_DAYS.map(date => usage(date, {
        planningSeconds: 121,
        firstChoiceSeconds: 11,
      })),
    })

    expect(result.ready).toBe(false)
    expect(result.criteria.find(criterion => criterion.key === 'planning_time')?.passed).toBe(false)
    expect(result.criteria.find(criterion => criterion.key === 'choice_time')?.passed).toBe(false)
  })

  it('uses the firm date for an activation just after UTC midnight', () => {
    const result = calculateCommandCenterCutoverReadiness({
      // 12:30 a.m. UTC is still the prior New York business date.
      enabledAt: '2026-10-02T00:30:00.000Z',
      cutoverAt: null,
      runs: TEN_BUSINESS_DAYS.map(date => run(date)),
      usage: TEN_BUSINESS_DAYS.map(date => usage(date)),
    })

    expect(result.parallelBusinessDays).toBe(10)
  })
})
