import os from 'node:os'
import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { loadFieldAuditFindings } from '@/lib/fieldAudit/history'
import { emitTasks } from '@/lib/fieldAudit/tasks'
import { loadRunContext } from '@/lib/runs/context'
import { finaliseRun } from '@/lib/runs/record'
import { reapAbandonedRuns } from '@/lib/runs/reaper'
import { toRunSteps } from '@/lib/runs/steps'
import { workRun } from '@/lib/runs/worker'
import { getAdminClient } from '@/lib/supabase/admin'
import type { FieldAuditBody } from '@aubrey-law/citations/prompt/body'
import { actionableFindings } from '@aubrey-law/citations/fieldAudit/runFieldAudit'

/**
 * The cron that works the run queue.
 *
 * A run spans as many invocations as it needs: this fires roughly once a
 * minute (`vercel.json`'s `crons` entry), reaps whatever the previous
 * invocation left mid-flight, claims one queued run, works it for up to
 * `TICK_BUDGET_MS`, and leaves the rest for the next tick if it isn't done.
 *
 * `maxDuration` matches `workRun`'s own budget headroom — 300 seconds against
 * a 240-second budget — for the same reason `app/api/cron/workflow-jobs/route.ts`
 * in the root app gives its own budget room under its own ceiling: a worker
 * killed at the platform's own limit loses whatever unit it was mid-way
 * through, after that unit's model call has already been paid for.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  // No secret means no, never "allow" — an unauthenticated worker able to
  // claim and work runs is worse than a queue that never runs at all.
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()

  // Reap first, so a run this same cron killed on the previous deploy is
  // handed back to the queue before this tick claims anything — otherwise it
  // sits `running`, looking alive, until some later tick happens to notice.
  const { reaped } = await reapAbandonedRuns(admin, () => Date.now())

  const worker = `${os.hostname()}:${process.pid}`
  const { data: claimed, error: claimError } = await admin.rpc('claim_workflow_run', { p_worker: worker })
  if (claimError) {
    return NextResponse.json({ error: `Could not claim a run: ${claimError.message}` }, { status: 500 })
  }

  // An empty claim returns HTTP 200 and a full row whose every column is
  // null — not JSON `null` — because `claim_workflow_run` is a composite-
  // returning plpgsql function. `!claimed` is therefore never true here, and
  // guarding on it would read "nothing to do" as "claimed a run whose id is
  // null": the worker would then query steps for `run_id = null`, find none,
  // and finalise a run that does not exist. The guard has to be on the id.
  if (claimed?.id == null) {
    return NextResponse.json({ reaped, claimedRunId: null, worked: 0, done: null })
  }

  const runId = String(claimed.id)

  const context = await loadRunContext(admin, runId)
  if (!context.ok) {
    return NextResponse.json({ reaped, claimedRunId: runId, error: context.message }, { status: 500 })
  }

  let callModel
  try {
    callModel = anthropicModelCaller()
  } catch (error) {
    if (error instanceof AnthropicKeyMissingError) {
      // 503, matching the review route's own handling of the same error:
      // the app is fine, this feature is not configured. The run stays
      // `running` and the claim's own heartbeat leaves it for the reaper to
      // hand back rather than lost.
      return NextResponse.json({ reaped, claimedRunId: runId, error: error.message }, { status: 503 })
    }
    throw error
  }

  const result = await workRun(admin, context, { callModel, now: () => Date.now() })

  if (result.done) {
    const { data: stepRows, error: stepsError } = await admin
      .from('workflow_run_steps')
      .select('unit_id, status, sequence, attempts, last_error, finding_id')
      .eq('run_id', runId)
    if (stepsError) {
      return NextResponse.json(
        { reaped, claimedRunId: runId, error: `Could not reload the run's steps: ${stepsError.message}` },
        { status: 500 },
      )
    }
    const steps = toRunSteps((stepRows ?? []) as never[])
    await finaliseRun(admin, runId, steps)

    // Tasks belong to the caller once a run is actually done, never to
    // `workRun` itself — see its own header comment. Only a field audit
    // emits them, and only from findings that survived reference
    // verification. This is now the only place `emitTasks` is ever called —
    // a first run and a retried run both reach it only here, once their run
    // has no `pending` steps left, so a run's tasks are created exactly
    // once no matter how many ticks it took.
    if (context.kind === 'field_audit') {
      const stored = await loadFieldAuditFindings(admin, runId)
      const actionable = actionableFindings({
        promptSlug: context.prompt.slug,
        promptVersion: context.prompt.versionNumber,
        findings: stored,
        failures: [],
      })
      await emitTasks(admin, {
        matterId: String(context.run.matter_id),
        runId,
        checks: (context.prompt.body as FieldAuditBody).checks,
        findings: actionable,
      })
    }
  }

  return NextResponse.json({ reaped, claimedRunId: runId, worked: result.worked, done: result.done })
}
