import 'server-only'

import os from 'node:os'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { ensureMatterSlaTasks } from '@/lib/slaTasks/generate'
import { fireEngineStageTask } from '@/lib/stage-engine/fireStageTasks'
import type { GeneratedDatabase, Json } from '@/types/supabase'
import { prepareInvoiceReminderDrafts } from '@/lib/billing/prepareInvoiceReminders'
export { prepareInvoiceReminderDrafts } from '@/lib/billing/prepareInvoiceReminders'

export type WorkflowJobType =
  | 'seed_design_sheet'
  | 'ensure_sla_plan'
  | 'fire_stage_task'
  | 'release_billing_milestone'
  | 'annual_review'
  | 'prepare_invoice_reminders'

export interface WorkflowJob {
  id: string
  matter_id: string | null
  job_type: WorkflowJobType
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  claim_token: string
  lease_expires_at: string
}

function generatedAdmin(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

export async function enqueueWorkflowJob(input: {
  type: WorkflowJobType
  dedupeKey: string
  matterId?: string | null
  payload?: Record<string, unknown>
  actorId?: string | null
}) {
  const { data, error } = await generatedAdmin().rpc('enqueue_workflow_job', {
    p_job_type: input.type,
    p_dedupe_key: input.dedupeKey,
    p_matter_id: input.matterId ?? null,
    p_payload: (input.payload ?? {}) as Json,
    p_actor_id: input.actorId ?? null,
  } as never)
  if (error) throw new Error(error.message)
  return data
}

export async function durableWorkflowJobsEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient().from('firm_settings')
    .select('durable_workflow_jobs_enabled').eq('id', 1).maybeSingle()
  return !error && data?.durable_workflow_jobs_enabled === true
}

async function createAnnualReviewTask(matterId: string, actorId: string | null) {
  const admin = getAdminClient()
  const { data: existing, error: existingError } = await admin
    .from('tasks')
    .select('id')
    .eq('matter_id', matterId)
    .ilike('title', 'Annual estate plan review')
    .in('status', ['open', 'in_progress', 'blocked'])
    .maybeSingle()
  if (existingError) throw new Error(existingError.message)
  if (existing) return

  const due = new Date()
  due.setFullYear(due.getFullYear() + 1)
  const { error } = await admin.from('tasks').insert({
    title: 'Annual estate plan review',
    description: 'Review life changes, beneficiary designations, fiduciaries, and plan documents with the client.',
    status: 'open',
    priority: 'normal',
    source: 'cadence',
    task_type: 'single',
    matter_id: matterId,
    due_at: due.toISOString(),
    assignee_id: actorId,
    recurrence: { every: 12, unit: 'month' },
    created_by: actorId,
  })
  if (error) throw new Error(error.message)
}

async function runJob(job: WorkflowJob) {
  const payload = job.payload ?? {}
  if (job.job_type === 'seed_design_sheet') {
    if (!job.matter_id) throw new Error('seed_design_sheet requires matter_id')
    await ensureDesignSheetSeededFromIntake(job.matter_id)
    return
  }
  if (job.job_type === 'ensure_sla_plan') {
    if (!job.matter_id) throw new Error('ensure_sla_plan requires matter_id')
    await ensureMatterSlaTasks(job.matter_id, {
      practiceArea: payload.practiceArea,
      retemplate: payload.retemplate === true,
    })
    return
  }
  if (job.job_type === 'fire_stage_task') {
    if (!job.matter_id || typeof payload.stage !== 'string') {
      throw new Error('fire_stage_task requires matter_id and stage')
    }
    await fireEngineStageTask(getAdminClient(), { matterId: job.matter_id, matterStage: payload.stage })
    return
  }
  if (job.job_type === 'release_billing_milestone') {
    if (!job.matter_id || typeof payload.trigger !== 'string') {
      throw new Error('release_billing_milestone requires matter_id and trigger')
    }
    const admin = getAdminClient()
    const { data: milestone, error: findError } = await admin
      .from('matter_fee_milestones')
      .select('id')
      .eq('matter_id', job.matter_id)
      .eq('trigger_key', payload.trigger)
      .eq('state', 'scheduled')
      .maybeSingle()
    if (findError) throw new Error(findError.message)
    if (!milestone) return
    const { error } = await admin.rpc('release_matter_fee_milestone_internal', {
      p_milestone_id: milestone.id,
      p_actor_id: null,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (job.job_type === 'annual_review') {
    if (!job.matter_id) throw new Error('annual_review requires matter_id')
    await createAnnualReviewTask(
      job.matter_id,
      typeof payload.actorId === 'string' ? payload.actorId : null,
    )
    return
  }
  // Reminder drafting is intentionally separate from sending. The approval
  // endpoint is the only path that can deliver a reminder.
  if (job.job_type === 'prepare_invoice_reminders') {
    const result = await prepareInvoiceReminderDrafts()
    if (result.unavailable) throw new Error('Reminder preparation unavailable')
    return
  }
  const exhaustive: never = job.job_type
  throw new Error(`Unsupported workflow job: ${exhaustive}`)
}

/** Claim one job at a time, reserving ten seconds of the route for cleanup. */
export async function processWorkflowJobs(limit = 10, options: {
  now?: () => number; run?: (job: WorkflowJob) => Promise<void>; budgetMs?: number
} = {}) {
  if (!await durableWorkflowJobsEnabled()) return { claimed: 0, succeeded: 0, failed: 0, disabled: true }
  const now = options.now ?? Date.now
  const deadline = now() + Math.min(options.budgetMs ?? 50_000, 50_000)
  const admin = generatedAdmin()
  const worker = `${os.hostname()}:${process.pid}`
  let claimed = 0, succeeded = 0, failed = 0
  while (claimed < Math.max(0, Math.min(limit, 50)) && deadline - now() >= 10_000) {
    const { data, error } = await admin.rpc('claim_workflow_jobs_v2', {
      p_limit: 1, p_worker: worker, p_lease_seconds: 120,
    })
    if (error) throw new Error(error.message)
    const job = (data as unknown as WorkflowJob[] | null)?.[0]
    if (!job) break
    claimed += 1
    let failure: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const remaining = deadline - now() - 1000
      if (remaining <= 0) throw new Error('Worker time budget exhausted before execution')
      await Promise.race([
        (options.run ?? runJob)(job),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Workflow execution timed out')), remaining) }),
      ])
    } catch (error) { failure = error instanceof Error ? error.message : 'Workflow job failed' }
    finally { if (timer) clearTimeout(timer) }
    const { data: finished, error: finishError } = await admin.rpc('finish_workflow_job_v2', {
      p_job_id: job.id, p_claim_token: job.claim_token, p_error: failure ?? undefined,
    })
    if (finishError) throw new Error(finishError.message)
    if (!finished) throw new Error('Workflow claim expired or was replaced; completion was not recorded')
    if (failure) failed += 1
    else succeeded += 1
  }
  return { claimed, succeeded, failed, disabled: false }
}
