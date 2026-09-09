import os from 'node:os'
import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { loadFieldAuditFindings } from '@/lib/fieldAudit/history'
import { emitTasks } from '@/lib/fieldAudit/tasks'
import { type FiduciarySweepResult, sweepFiduciaryTasks } from '@/lib/fiduciary/sweep'
import { type IdentitySweepResult, sweepNameAgreement } from '@/lib/identity/sweep'
import { loadRunContext } from '@/lib/runs/context'
import { finaliseRun } from '@/lib/runs/record'
import { reapAbandonedRuns } from '@/lib/runs/reaper'
import { toRunSteps } from '@/lib/runs/steps'
import { materialiseStageTrigger } from '@/lib/runs/triggers'
import { workRun } from '@/lib/runs/worker'
import { getAdminClient } from '@/lib/supabase/admin'
import type { FieldAuditBody } from '@aubrey-law/citations/prompt/body'

/**
 * The cron that works the run queue.
 *
 * A run spans as many invocations as it needs: this fires roughly once a
 * minute (`vercel.json`'s `crons` entry), reaps whatever the previous
 * invocation left mid-flight, materialises one pending stage trigger into a
 * queued run (`materialiseStageTrigger` — see its own module for why that
 * happens before the claim below), sweeps the fiduciary matrix's gaps and the
 * matters whose name disagrees with the sheet they draft from into tasks,
 * claims one queued run, works it for up to `TICK_BUDGET_MS`, and leaves the
 * rest for the next tick if it isn't done.
 *
 * The two sweeps are the only things here that are not the queue's own work,
 * and they are carried rather than depended on: neither makes a model call,
 * and a sweep that fails is reported in the payload while the tick gets on
 * with the queue.
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

  // Materialise before claiming. A stage trigger that fired seconds ago
  // becomes a queued run now, and the claim below may pick it up in this
  // same invocation rather than leaving it for the next minute. Its own
  // internal claim (`claim_prompt_stage_trigger`) has exactly the same
  // null-row shape as `claim_workflow_run` below — see that call's comment —
  // and `materialiseStageTrigger` already guards on the id, not falsiness.
  const materialised = await materialiseStageTrigger(admin, worker)

  // The fiduciary sweep. Unqueued and run on every tick on purpose — see
  // `sweepFiduciaryTasks` for why the machinery to schedule one sweep would
  // cost more than the sweep. It sits after the queue's own ordering above and
  // before the claim below: the commonest tick claims nothing and returns
  // early, so a sweep placed after the claim would be the sweep that mostly
  // never runs.
  //
  // A failing sweep must not fail the tick. The run queue is why this cron
  // exists; the sweep is a cheap extra it carries. A sweep that could not read
  // the appointments this minute is reported in the payload and left for the
  // next one sixty seconds away, and it takes nothing else down with it. The
  // error is *carried*, never dropped: a sweep that quietly reported an
  // all-zero pass would say it found nothing wrong when what happened is that
  // it could not tell.
  let fiduciary: FiduciarySweepResult | { error: string }
  try {
    fiduciary = await sweepFiduciaryTasks(admin)
  } catch (error) {
    fiduciary = { error: error instanceof Error ? error.message : String(error) }
  }

  // The name check, beside the fiduciary sweep and for the same reasons: cheap,
  // unqueued, and placed before the claim because the commonest tick claims
  // nothing and returns early.
  //
  // Wrapped the same way, and the reason is the same sentence written above:
  // an error is carried in the payload, never dropped. A sweep that reported an
  // all-zero pass would say it found nothing wrong when what happened is that
  // it could not tell — and this one *withdraws* tasks when it finds nothing,
  // so that distinction is the difference between "the names now agree" and
  // "the query failed". `sweepNameAgreement` throws rather than returning a
  // zeroed result for exactly that reason; this catch is what keeps the throw
  // from taking the run queue down with it.
  let identity: IdentitySweepResult | { error: string }
  try {
    identity = await sweepNameAgreement(admin)
  } catch (error) {
    identity = { error: error instanceof Error ? error.message : String(error) }
  }

  const { data: claimed, error: claimError } = await admin.rpc('claim_workflow_run', { p_worker: worker })
  if (claimError) {
    return NextResponse.json({ reaped, materialised, fiduciary, identity, error: `Could not claim a run: ${claimError.message}` }, { status: 500 })
  }

  // An empty claim returns HTTP 200 and a full row whose every column is
  // null — not JSON `null` — because `claim_workflow_run` is a composite-
  // returning plpgsql function. `!claimed` is therefore never true here, and
  // guarding on it would read "nothing to do" as "claimed a run whose id is
  // null": the worker would then query steps for `run_id = null`, find none,
  // and finalise a run that does not exist. The guard has to be on the id.
  if (claimed?.id == null) {
    // `materialised` is included here too — not only once a run is
    // claimed — because a tick that only materialised a trigger into a run
    // (this invocation's claim above may simply have lost the race for it,
    // or arrived too late in the same tick to see it) must not report
    // `claimedRunId: null` and read as having done nothing.
    return NextResponse.json({ reaped, materialised, fiduciary, identity, claimedRunId: null, worked: 0, done: null })
  }

  const runId = String(claimed.id)

  const context = await loadRunContext(admin, runId)
  if (!context.ok) {
    return NextResponse.json({ reaped, materialised, fiduciary, identity, claimedRunId: runId, error: context.message }, { status: 500 })
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
      return NextResponse.json({ reaped, materialised, fiduciary, identity, claimedRunId: runId, error: error.message }, { status: 503 })
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
        { reaped, materialised, fiduciary, identity, claimedRunId: runId, error: `Could not reload the run's steps: ${stepsError.message}` },
        { status: 500 },
      )
    }
    const steps = toRunSteps((stepRows ?? []) as never[])
    await finaliseRun(admin, runId, steps)

    // Tasks belong to the caller once a run is actually done, never to
    // `workRun` itself — see its own header comment. Only a field audit emits
    // them, and only from findings that survived reference verification —
    // which `emitTasks` now decides, from everything this hands it. This is
    // the only place `emitTasks` is ever called — a first run and a retried
    // run both reach it only here, once their run has no `pending` steps left.
    if (context.kind === 'field_audit') {
      const body = context.prompt.body as FieldAuditBody
      const stored = await loadFieldAuditFindings(admin, runId)
      await emitTasks(admin, {
        matterId: String(context.run.matter_id),
        runId,
        checks: body.checks,
        // Every finding, not the gated subset: `emitTasks` applies the gate,
        // and the withdrawal rule needs the outcomes it discards. A run that
        // cleared a check is what entitles it to retire an earlier task, and
        // a `compliant` finding never survives the gate.
        findings: stored,
        // A unit that did not succeed answered nothing, so it retires nothing.
        failedCheckNumbers: steps.filter((step) => step.status !== 'succeeded').map((step) => step.unitId),
        // The target from the version this run pinned, never the published
        // one: a prompt republished as `chat` since must not retroactively
        // decide that a `task_set` run mid-flight produces nothing.
        // `loadRunContext` reads `prompt_version_id` for exactly this reason.
        outputTarget: body.outputTarget,
        promptTitle: context.prompt.title,
        // Only this prompt's own tasks are this run's to touch. Two prompts
        // emitting on one matter would otherwise each withdraw the other's.
        promptId: context.prompt.promptId,
      })
    }
  }

  return NextResponse.json({ reaped, materialised, fiduciary, identity, claimedRunId: runId, worked: result.worked, done: result.done })
}
