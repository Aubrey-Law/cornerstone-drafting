import { calculateCommandCenterRolloutReadiness, type WorkGraphReconciliationRun } from '@/lib/work/rollout'
import { firmDateKey } from '@/lib/firmDate'

export const COMMAND_CENTER_CUTOVER_THRESHOLDS = {
  minimumParallelBusinessDays: 10,
  maximumMedianPlanningSeconds: 120,
  maximumMedianChoiceSeconds: 10,
  minimumCoveragePercent: 95,
} as const

export interface CommandCenterUsageDay {
  userId: string
  firmDate: string
  commandCenterOpenCount: number
  legacyTodayOpenCount: number
  planGeneratedCount: number
  planReplannedCount: number
  planCommittedCount: number
  planClosedCount: number
  workStartedCount: number
  workCompletedCount: number
  workSnoozedCount: number
  workBlockedCount: number
  planningSeconds: number | null
  firstChoiceSeconds: number | null
  firstOpenedAt: string | null
  lastEventAt: string
}

export interface CutoverCriterion {
  key: string
  label: string
  passed: boolean
  detail: string
}

export interface CommandCenterCutoverReadiness {
  ready: boolean
  cutoverComplete: boolean
  parallelBusinessDays: number
  medianPlanningSeconds: number | null
  medianChoiceSeconds: number | null
  completionRatePercent: number | null
  legacyOpenCount: number
  snoozeCount: number
  automationFailureCount: number
  criteria: CutoverCriterion[]
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? Math.round((ordered[middle - 1] + ordered[middle]) / 2)
    : ordered[middle]
}

function isBusinessDate(value: string): boolean {
  const day = new Date(`${value}T12:00:00.000Z`).getUTCDay()
  return day >= 1 && day <= 5
}

export function calculateCommandCenterCutoverReadiness(input: {
  enabledAt: string | null
  cutoverAt: string | null
  runs: WorkGraphReconciliationRun[]
  usage: CommandCenterUsageDay[]
}): CommandCenterCutoverReadiness {
  const orderedRuns = [...input.runs].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt)
  ))
  const enabledDate = input.enabledAt ? firmDateKey(input.enabledAt) : null
  const rollout = calculateCommandCenterRolloutReadiness(orderedRuns)
  const latestRunByDate = new Map<string, WorkGraphReconciliationRun>()
  for (const run of orderedRuns) {
    if (enabledDate && run.firmDate < enabledDate) continue
    if (!isBusinessDate(run.firmDate) || latestRunByDate.has(run.firmDate)) continue
    latestRunByDate.set(run.firmDate, run)
  }
  const usageByDate = new Map(input.usage.map(day => [day.firmDate, day]))
  const evidenceRuns = [...latestRunByDate.values()].filter(run => (
    run.readinessPassed && (usageByDate.get(run.firmDate)?.commandCenterOpenCount ?? 0) > 0
  ))
  const evidenceDates = new Set(evidenceRuns.map(run => run.firmDate))
  const evidenceUsage = input.usage.filter(day => evidenceDates.has(day.firmDate))
  const planning = evidenceUsage.flatMap(day => day.planningSeconds === null ? [] : [day.planningSeconds])
  const choices = evidenceUsage.flatMap(day => day.firstChoiceSeconds === null ? [] : [day.firstChoiceSeconds])
  const medianPlanningSeconds = median(planning)
  const medianChoiceSeconds = median(choices)
  const started = evidenceUsage.reduce((sum, day) => sum + day.workStartedCount, 0)
  const completed = evidenceUsage.reduce((sum, day) => sum + day.workCompletedCount, 0)
  const completionRatePercent = started > 0 ? Math.min(100, Math.round((completed / started) * 10_000) / 100) : null
  const legacyOpenCount = evidenceUsage.reduce((sum, day) => sum + day.legacyTodayOpenCount, 0)
  const snoozeCount = evidenceUsage.reduce((sum, day) => sum + day.workSnoozedCount, 0)
  const missedCriticalCount = evidenceRuns.reduce((sum, run) => sum + run.criticalMisclassifiedCount, 0)
  const duplicateCount = evidenceRuns.reduce((sum, run) => sum + run.duplicateCount, 0)
  const minimumCoverage = evidenceRuns.length
    ? Math.min(...evidenceRuns.map(run => run.coveragePercent))
    : null
  const latest = orderedRuns[0] ?? null
  const automationFailureCount = latest?.sourceCounts.automation_failure ?? 0

  const criteria: CutoverCriterion[] = [
    {
      key: 'enabled',
      label: 'Parallel Command Center is enabled',
      passed: Boolean(input.enabledAt),
      detail: enabledDate ? `Started ${enabledDate}` : 'Enable the parallel run first',
    },
    {
      key: 'graph',
      label: 'Canonical work graph remains healthy',
      passed: rollout.ready,
      detail: rollout.ready ? 'Latest reconciliation gate passed' : 'Reconciliation gate needs attention',
    },
    {
      key: 'parallel_days',
      label: 'Ten business days of parallel evidence',
      passed: evidenceDates.size >= COMMAND_CENTER_CUTOVER_THRESHOLDS.minimumParallelBusinessDays,
      detail: `${evidenceDates.size}/${COMMAND_CENTER_CUTOVER_THRESHOLDS.minimumParallelBusinessDays} business days`,
    },
    {
      key: 'coverage',
      label: 'At least 95% legacy coverage every evidence day',
      passed: minimumCoverage !== null && minimumCoverage >= COMMAND_CENTER_CUTOVER_THRESHOLDS.minimumCoveragePercent,
      detail: minimumCoverage === null ? 'No parallel evidence yet' : `${minimumCoverage.toFixed(2)}% minimum`,
    },
    {
      key: 'critical',
      label: 'No missed or misclassified hard deadlines',
      passed: evidenceRuns.length > 0 && missedCriticalCount === 0,
      detail: `${missedCriticalCount} critical defects`,
    },
    {
      key: 'duplicates',
      label: 'No duplicate obligations',
      passed: evidenceRuns.length > 0 && duplicateCount === 0,
      detail: `${duplicateCount} duplicates`,
    },
    {
      key: 'planning_time',
      label: 'Median morning planning stays under two minutes',
      passed: medianPlanningSeconds !== null && medianPlanningSeconds <= COMMAND_CENTER_CUTOVER_THRESHOLDS.maximumMedianPlanningSeconds,
      detail: medianPlanningSeconds === null ? 'No committed-plan sample yet' : `${medianPlanningSeconds} seconds median`,
    },
    {
      key: 'choice_time',
      label: 'Median next-task choice stays under ten seconds',
      passed: medianChoiceSeconds !== null && medianChoiceSeconds <= COMMAND_CENTER_CUTOVER_THRESHOLDS.maximumMedianChoiceSeconds,
      detail: medianChoiceSeconds === null ? 'No started-work sample yet' : `${medianChoiceSeconds} seconds median`,
    },
  ]

  return {
    ready: criteria.every(criterion => criterion.passed),
    cutoverComplete: Boolean(input.cutoverAt),
    parallelBusinessDays: evidenceDates.size,
    medianPlanningSeconds,
    medianChoiceSeconds,
    completionRatePercent,
    legacyOpenCount,
    snoozeCount,
    automationFailureCount,
    criteria,
  }
}
