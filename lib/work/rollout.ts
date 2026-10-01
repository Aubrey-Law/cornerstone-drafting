import { WORK_SOURCE_TYPES, type WorkGraphResult, type WorkSourceType } from '@/lib/work/types'
import type { WorkGraphReconciliation } from '@/lib/work/reconciliation'

export const COMMAND_CENTER_ROLLOUT_THRESHOLDS = {
  minimumSamples: 3,
  minimumCoveragePercent: 95,
  maximumP95DurationMs: 1_500,
} as const

export type ReconciliationTrigger = 'manual' | 'cron' | 'activation'

export interface WorkGraphReconciliationRun {
  id: string
  userId: string
  firmDate: string
  trigger: ReconciliationTrigger
  generatedAt: string
  durationMs: number
  legacyCount: number
  canonicalCount: number
  mappedCount: number
  coveragePercent: number
  omittedCount: number
  duplicateCount: number
  differentlyRankedCount: number
  additionalCount: number
  criticalCount: number
  criticalMisclassifiedCount: number
  ownershipViolationCount: number
  sourceErrorCodes: string[]
  sourceCounts: Partial<Record<WorkSourceType, number>>
  readinessPassed: boolean
  createdAt: string
}

export interface WorkGraphRolloutSnapshot {
  metrics: Omit<WorkGraphReconciliationRun, 'id' | 'userId' | 'firmDate' | 'trigger' | 'createdAt'>
  reconciliation: WorkGraphReconciliation
}

export interface RolloutCriterion {
  key: string
  label: string
  passed: boolean
  detail: string
}

export interface CommandCenterRolloutReadiness {
  ready: boolean
  sampleCount: number
  consecutivePasses: number
  p95DurationMs: number | null
  latest: WorkGraphReconciliationRun | null
  criteria: RolloutCriterion[]
}

function percentile95(values: number[]): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]
}

export function analyzeWorkGraphRollout(
  graph: WorkGraphResult,
  reconciliation: WorkGraphReconciliation,
  durationMs: number,
  now: Date,
): WorkGraphRolloutSnapshot {
  const sourceCounts: Partial<Record<WorkSourceType, number>> = {}
  for (const sourceType of WORK_SOURCE_TYPES) {
    const count = graph.items.filter(item => item.sourceType === sourceType).length
    if (count > 0) sourceCounts[sourceType] = count
  }

  const criticalMisclassifiedCount = graph.items.filter(item => (
    Boolean(item.hardDueAt)
    && new Date(item.hardDueAt!).getTime() < now.getTime()
    && item.priorityBand !== 0
  )).length
  const ownershipViolationCount = graph.items.filter(item => (
    item.owner !== 'firm' && item.priorityBand <= 1
  )).length
  const sourceErrorCodes = [...new Set(graph.sourceErrors)].sort()
  const readinessPassed = (
    reconciliation.coveragePercent >= COMMAND_CENTER_ROLLOUT_THRESHOLDS.minimumCoveragePercent
    && reconciliation.duplicateWorkKeys.length === 0
    && criticalMisclassifiedCount === 0
    && ownershipViolationCount === 0
    && sourceErrorCodes.length === 0
    && durationMs <= COMMAND_CENTER_ROLLOUT_THRESHOLDS.maximumP95DurationMs
  )

  return {
    metrics: {
      generatedAt: graph.generatedAt,
      durationMs,
      legacyCount: reconciliation.legacyCount,
      canonicalCount: reconciliation.canonicalCount,
      mappedCount: reconciliation.mappedCount,
      coveragePercent: reconciliation.coveragePercent,
      omittedCount: reconciliation.omittedWorkKeys.length,
      duplicateCount: reconciliation.duplicateWorkKeys.length,
      differentlyRankedCount: reconciliation.differentlyRanked.length,
      additionalCount: reconciliation.additionalCanonicalWorkKeys.length,
      criticalCount: graph.items.filter(item => item.priorityBand === 0).length,
      criticalMisclassifiedCount,
      ownershipViolationCount,
      sourceErrorCodes,
      sourceCounts,
      readinessPassed,
    },
    reconciliation,
  }
}

export function calculateCommandCenterRolloutReadiness(
  runs: WorkGraphReconciliationRun[],
): CommandCenterRolloutReadiness {
  const latest = runs[0] ?? null
  const consecutivePasses = runs.findIndex(run => !run.readinessPassed)
  const passingStreak = consecutivePasses === -1 ? runs.length : consecutivePasses
  const p95DurationMs = percentile95(runs.map(run => run.durationMs))
  const criteria: RolloutCriterion[] = [
    {
      key: 'samples',
      label: 'Enough repeatable samples',
      passed: runs.length >= COMMAND_CENTER_ROLLOUT_THRESHOLDS.minimumSamples,
      detail: `${runs.length}/${COMMAND_CENTER_ROLLOUT_THRESHOLDS.minimumSamples} samples recorded`,
    },
    {
      key: 'coverage',
      label: 'Legacy work is represented',
      passed: Boolean(latest && latest.coveragePercent >= COMMAND_CENTER_ROLLOUT_THRESHOLDS.minimumCoveragePercent),
      detail: latest ? `${latest.coveragePercent.toFixed(2)}% coverage` : 'No sample yet',
    },
    {
      key: 'duplicates',
      label: 'No duplicate obligations',
      passed: Boolean(latest && latest.duplicateCount === 0),
      detail: latest ? `${latest.duplicateCount} duplicates` : 'No sample yet',
    },
    {
      key: 'critical',
      label: 'Every overdue hard deadline is Critical',
      passed: Boolean(latest && latest.criticalMisclassifiedCount === 0),
      detail: latest ? `${latest.criticalMisclassifiedCount} misclassified` : 'No sample yet',
    },
    {
      key: 'ownership',
      label: 'Waiting work stays out of Must Do',
      passed: Boolean(latest && latest.ownershipViolationCount === 0),
      detail: latest ? `${latest.ownershipViolationCount} ownership violations` : 'No sample yet',
    },
    {
      key: 'sources',
      label: 'All work sources responded',
      passed: Boolean(latest && latest.sourceErrorCodes.length === 0),
      detail: latest?.sourceErrorCodes.length ? latest.sourceErrorCodes.join(', ') : latest ? 'No source errors' : 'No sample yet',
    },
    {
      key: 'performance',
      label: 'Work graph meets the 1.5-second target',
      passed: p95DurationMs !== null && p95DurationMs <= COMMAND_CENTER_ROLLOUT_THRESHOLDS.maximumP95DurationMs,
      detail: p95DurationMs === null ? 'No sample yet' : `${p95DurationMs} ms p95`,
    },
    {
      key: 'streak',
      label: 'The latest samples pass consecutively',
      passed: passingStreak >= COMMAND_CENTER_ROLLOUT_THRESHOLDS.minimumSamples,
      detail: `${passingStreak}/${COMMAND_CENTER_ROLLOUT_THRESHOLDS.minimumSamples} consecutive passes`,
    },
  ]

  return {
    ready: criteria.every(criterion => criterion.passed),
    sampleCount: runs.length,
    consecutivePasses: passingStreak,
    p95DurationMs,
    latest,
    criteria,
  }
}
