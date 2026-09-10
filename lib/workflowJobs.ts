import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import 'server-only'

import os from 'node:os'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { ensureMatterSlaTasks } from '@/lib/slaTasks/generate'
import { fireEngineStageTask } from '@/lib/stage-engine/fireStageTasks'
import type { GeneratedDatabase, Json } from '@/types/supabase'
import { firmTodayKey } from '@/lib/firmDate'

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
  if (job.job_type === 'prepare_invoice_reminders') return
  const exhaustive: never = job.job_type
  throw new Error(`Unsupported workflow job: ${exhaustive}`)
}

const REMINDER_COPY = {
  friendly: 'A quick reminder that this invoice is now due. If payment is already on its way, thank you and please disregard this note.',
  firm: 'This invoice remains past due. Please arrange payment or let us know when we should expect it.',
  final: 'This invoice remains unpaid and is significantly past due. Please arrange payment or contact the firm to discuss the account.',
} as const

function mondayKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

/** Drafts at most one reminder per overdue invoice per firm week. Never sends. */
export async function prepareInvoiceReminderDrafts() {
  const admin = getAdminClient()
  const today = firmTodayKey()
  const cadenceWeek = mondayKey(today)
  const { data, error } = await admin
    .from('invoices')
    .select('id, number, subtotal_cents, due_date, bill_to_email, kind')
    .in('status', ['issued', 'partial'])
    .not('due_date', 'is', null)
    .lt('due_date', today)
  if (error) {
    // Feature may be disabled and its migration intentionally unapplied.
    return { drafted: 0, unavailable: true }
  }
  const balances = await loadInvoiceBalances(admin, data ?? [])
  let drafted = 0
  for (const invoice of data ?? []) {
    if (!invoice.bill_to_email || !invoice.due_date) continue
    if ((balances.get(invoice.id) ?? 0) <= 0) continue
    const days = Math.max(1, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${invoice.due_date}T12:00:00Z`)) / 86_400_000))
    const level = days >= 28 ? 'final' : days >= 14 ? 'firm' : 'friendly'
    const { error: insertError } = await admin.from('invoice_reminders').insert({
      invoice_id: invoice.id,
      cadence_week: cadenceWeek,
      escalation_level: level,
      recipient_email: invoice.bill_to_email,
      subject: `Reminder: invoice ${invoice.number ?? ''}`.trim(),
      body: REMINDER_COPY[level],
    })
    if (!insertError) drafted += 1
    else if (insertError.code !== '23505') console.error('[workflow-jobs] reminder draft:', insertError.message)
  }
  return { drafted, unavailable: false }
}

export async function processWorkflowJobs(limit = 10) {
  const reminders = await prepareInvoiceReminderDrafts()
  const admin = generatedAdmin()
  const worker = `${os.hostname()}:${process.pid}`
  const { data, error } = await admin.rpc('claim_workflow_jobs', {
    p_limit: limit,
    p_worker: worker,
  } as never)
  if (error) throw new Error(error.message)
  const jobs = (data ?? []) as unknown as WorkflowJob[]
  let succeeded = 0
  let failed = 0
  for (const job of jobs) {
    let failure: string | null = null
    try {
      await runJob(job)
      succeeded += 1
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Workflow job failed'
      failed += 1
    }
    const { error: finishError } = await admin.rpc('finish_workflow_job', {
      p_job_id: job.id,
      p_error: failure,
    } as never)
    if (finishError) throw new Error(finishError.message)
  }
  return { claimed: jobs.length, succeeded, failed, reminderDrafts: reminders.drafted }
}
