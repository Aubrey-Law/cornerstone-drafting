import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { reapAbandonedRuns, reapDecision, STALE_AFTER_MS, MAX_RECLAIMS } from '@/lib/runs/reaper'
import { makeFakeClient } from './helpers/fakeSupabase'

const minutes = (n: number) => n * 60_000

describe('deciding a run was abandoned', () => {
  it('leaves a run whose worker is still stamping alone', () => {
    expect(reapDecision({ status: 'running', lastTickAt: minutes(1), reclaims: 0 }, minutes(2)))
      .toEqual({ reap: false })
  })

  it('reaps a run whose heartbeat stopped', () => {
    // Nothing will ever finish it. Left alone it reads as "in progress"
    // forever, which is worse than saying it died.
    expect(reapDecision({ status: 'running', lastTickAt: 0, reclaims: 0 }, STALE_AFTER_MS + 1))
      .toEqual({ reap: true, requeue: true })
  })

  it('stops requeueing a run that has killed enough workers', () => {
    // Handing it back forever is how one bad run becomes a permanent load.
    expect(reapDecision({ status: 'running', lastTickAt: 0, reclaims: MAX_RECLAIMS }, STALE_AFTER_MS + 1))
      .toEqual({ reap: true, requeue: false })
  })

  it('never reaps a run that is not running', () => {
    for (const status of ['queued', 'completed', 'partial', 'failed'] as const) {
      expect(reapDecision({ status, lastTickAt: 0, reclaims: 0 }, minutes(60)).reap).toBe(false)
    }
  })

  it('never reaps a run that has not stamped at all yet', () => {
    // A run claimed a moment ago has a `last_tick_at` from the claim itself.
    // A null one means the claim has not happened, so there is no worker to
    // have died — reaping it would fight the claim.
    expect(reapDecision({ status: 'running', lastTickAt: null, reclaims: 0 }, minutes(60)).reap).toBe(false)
  })
})

/** A `running` run, seeded with one `running` step and one `pending` step. */
function stubClient(config: { lastTickAt: string | null; reclaims: number }) {
  const base = makeFakeClient({
    workflow_runs: [
      {
        id: 'run-1',
        kind: 'field_audit',
        status: 'running',
        last_tick_at: config.lastTickAt,
        reclaims: config.reclaims,
        matter_id: 'm1',
      },
    ],
    workflow_run_steps: [
      { run_id: 'run-1', unit_id: '1', status: 'succeeded', sequence: 0 },
      { run_id: 'run-1', unit_id: '2', status: 'running', sequence: 1 },
      { run_id: 'run-1', unit_id: '3', status: 'pending', sequence: 2 },
    ],
  })
  return base
}

describe('applying the decision to the database', () => {
  it('fails the running step, requeues the run, and counts the reclaim', async () => {
    const client = stubClient({ lastTickAt: new Date(0).toISOString(), reclaims: 0 })
    const result = await reapAbandonedRuns(
      client as unknown as SupabaseClient<WorkbenchDatabase>,
      () => STALE_AFTER_MS + 1,
    )
    expect(result).toEqual({ reaped: 1 })

    const run = client.tableRows('workflow_runs')[0] as { status: string; reclaims: number }
    expect(run.status).toBe('queued')
    expect(run.reclaims).toBe(1)

    const steps = client.tableRows('workflow_run_steps') as Array<{ unit_id: string; status: string; last_error: string | null }>
    expect(steps.find((s) => s.unit_id === '2')).toMatchObject({
      status: 'failed',
      last_error: 'The worker running this step stopped without finishing it.',
    })
    // Untouched: neither already-settled nor never-started steps are this run's fault to rewrite.
    expect(steps.find((s) => s.unit_id === '1')?.status).toBe('succeeded')
    expect(steps.find((s) => s.unit_id === '3')?.status).toBe('pending')
  })

  it('gives up instead of requeueing once reclaims are spent', async () => {
    const client = stubClient({ lastTickAt: new Date(0).toISOString(), reclaims: MAX_RECLAIMS })
    await reapAbandonedRuns(client as unknown as SupabaseClient<WorkbenchDatabase>, () => STALE_AFTER_MS + 1)

    const run = client.tableRows('workflow_runs')[0] as { status: string; reclaims: number }
    expect(run.status).toBe('partial')
    expect(run.reclaims).toBe(MAX_RECLAIMS)
  })

  it('leaves a run alone whose heartbeat is still fresh', async () => {
    const client = stubClient({ lastTickAt: new Date(0).toISOString(), reclaims: 0 })
    const result = await reapAbandonedRuns(client as unknown as SupabaseClient<WorkbenchDatabase>, () => minutes(1))
    expect(result).toEqual({ reaped: 0 })
    expect((client.tableRows('workflow_runs')[0] as { status: string }).status).toBe('running')
  })
})
