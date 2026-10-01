import 'server-only'

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchTodayData } from '@/lib/queries/today'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { buildWorkGraph } from '@/lib/work/buildWorkGraph'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { reconcileWorkGraphs } from '@/lib/work/reconciliation'
import {
  analyzeWorkGraphRollout,
  calculateCommandCenterRolloutReadiness,
  type ReconciliationTrigger,
  type WorkGraphReconciliationRun,
} from '@/lib/work/rollout'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import type { WorkSourceType } from '@/lib/work/types'

interface ReconciliationRunRow {
  id: string
  user_id: string
  firm_date: string
  trigger: ReconciliationTrigger
  generated_at: string
  duration_ms: number
  legacy_count: number
  canonical_count: number
  mapped_count: number
  coverage_percent: number | string
  omitted_count: number
  duplicate_count: number
  differently_ranked_count: number
  additional_count: number
  critical_count: number
  critical_misclassified_count: number
  ownership_violation_count: number
  source_error_codes: string[] | null
  source_counts: Partial<Record<WorkSourceType, number>> | null
  readiness_passed: boolean
  created_at: string
}

function rowToRun(row: ReconciliationRunRow): WorkGraphReconciliationRun {
  return {
    id: row.id,
    userId: row.user_id,
    firmDate: row.firm_date,
    trigger: row.trigger,
    generatedAt: row.generated_at,
    durationMs: row.duration_ms,
    legacyCount: row.legacy_count,
    canonicalCount: row.canonical_count,
    mappedCount: row.mapped_count,
    coveragePercent: Number(row.coverage_percent),
    omittedCount: row.omitted_count,
    duplicateCount: row.duplicate_count,
    differentlyRankedCount: row.differently_ranked_count,
    additionalCount: row.additional_count,
    criticalCount: row.critical_count,
    criticalMisclassifiedCount: row.critical_misclassified_count,
    ownershipViolationCount: row.ownership_violation_count,
    sourceErrorCodes: row.source_error_codes ?? [],
    sourceCounts: row.source_counts ?? {},
    readinessPassed: row.readiness_passed,
    createdAt: row.created_at,
  }
}

export async function listWorkGraphReconciliationRuns(
  userId: string,
  limit = 20,
): Promise<WorkGraphReconciliationRun[]> {
  const { data, error } = await getAdminClient()
    .from('work_graph_reconciliation_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)))
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ReconciliationRunRow[]).map(rowToRun)
}

export async function getCommandCenterRolloutReadiness(userId: string) {
  return calculateCommandCenterRolloutReadiness(await listWorkGraphReconciliationRuns(userId))
}

export async function runWorkGraphReconciliation(input: {
  userId: string
  trigger: ReconciliationTrigger
  now?: Date
  idempotencyKey?: string
}) {
  const now = input.now ?? new Date()
  const idempotencyKey = input.idempotencyKey ?? `work-graph:${input.trigger}:${randomUUID()}`
  const admin = getAdminClient()
  const { data: existing, error: existingError } = await admin
    .from('work_graph_reconciliation_runs')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message)
  if (existing) {
    const run = rowToRun(existing as unknown as ReconciliationRunRow)
    return { run, readiness: await getCommandCenterRolloutReadiness(input.userId), reconciliation: null }
  }

  const started = performance.now()
  const [graph, preferences] = await Promise.all([
    fetchWorkGraphForUser(input.userId, now),
    fetchWorkPreferences(input.userId),
  ])
  createDailyPlanPreview({ items: graph.items, appointments: graph.appointments, preferences, now })
  const durationMs = Math.max(0, Math.round(performance.now() - started))

  const legacyToday = await fetchTodayData({ includeCalendar: false })
  const legacy = buildWorkGraph({ today: legacyToday }, now)
  const reconciliation = reconcileWorkGraphs(legacy, graph)
  const snapshot = analyzeWorkGraphRollout(graph, reconciliation, durationMs, now)
  const metrics = snapshot.metrics

  const { data, error } = await admin.from('work_graph_reconciliation_runs').insert({
    user_id: input.userId,
    firm_date: firmTodayKey(now),
    trigger: input.trigger,
    idempotency_key: idempotencyKey,
    generated_at: metrics.generatedAt,
    duration_ms: metrics.durationMs,
    legacy_count: metrics.legacyCount,
    canonical_count: metrics.canonicalCount,
    mapped_count: metrics.mappedCount,
    coverage_percent: metrics.coveragePercent,
    omitted_count: metrics.omittedCount,
    duplicate_count: metrics.duplicateCount,
    differently_ranked_count: metrics.differentlyRankedCount,
    additional_count: metrics.additionalCount,
    critical_count: metrics.criticalCount,
    critical_misclassified_count: metrics.criticalMisclassifiedCount,
    ownership_violation_count: metrics.ownershipViolationCount,
    source_error_codes: metrics.sourceErrorCodes,
    source_counts: metrics.sourceCounts,
    readiness_passed: metrics.readinessPassed,
  }).select('*').single()
  if (error?.code === '23505') {
    // A concurrent cron retry can finish between the initial lookup and insert.
    // Return the winning row so identical requests remain idempotent.
    const { data: concurrent, error: concurrentError } = await admin
      .from('work_graph_reconciliation_runs')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single()
    if (concurrentError) throw new Error(concurrentError.message)
    const run = rowToRun(concurrent as unknown as ReconciliationRunRow)
    return { run, readiness: await getCommandCenterRolloutReadiness(input.userId), reconciliation: null }
  }
  if (error) throw new Error(error.message)
  const run = rowToRun(data as unknown as ReconciliationRunRow)
  const runs = [run, ...(await listWorkGraphReconciliationRuns(input.userId)).filter(item => item.id !== run.id)]

  return {
    run,
    readiness: calculateCommandCenterRolloutReadiness(runs.slice(0, 20)),
    reconciliation: snapshot.reconciliation,
  }
}
