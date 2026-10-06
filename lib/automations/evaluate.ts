import 'server-only'

import type { ActionProposalRequest } from '@/lib/actions/types'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { AutomationActionKey, AutomationTriggerKey } from '@/lib/automations/registry'

export interface AutomationRuleRecord {
  id: string
  name: string
  trigger_key: AutomationTriggerKey
  action_key: AutomationActionKey
  conditions: Record<string, unknown>
  action_config: Record<string, unknown>
  approval_policy: 'automatic' | 'required' | 'prohibited'
  mode: 'dry_run' | 'live' | 'paused'
  updated_by: string | null
  max_attempts: number
}

export interface AutomationCandidateAction extends Omit<ActionProposalRequest, 'idempotencyKey' | 'source' | 'automationRunId'> {
  eventKey: string
}

export interface AutomationCandidate {
  candidateKey: string
  recordType: 'lead' | 'matter' | 'firm'
  recordId?: string
  title: string
  reason: string
  href: string
  actions: AutomationCandidateAction[]
}

function numberCondition(conditions: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = conditions[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}

function isoBefore(now: Date, days: number) {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

function isoAfter(now: Date, days: number) {
  return new Date(now.getTime() + days * 86_400_000).toISOString()
}

function taskAction(input: {
  eventKey: string
  title: string
  matterId?: string | null
  leadId?: string | null
  dueAt?: string | null
  description?: string
}): AutomationCandidateAction {
  return {
    eventKey: input.eventKey,
    actionKey: 'task.create',
    displaySummary: input.title,
    referencePayload: {
      title: input.title,
      description: input.description ?? null,
      priority: 'normal',
      source: 'automation',
      task_type: 'single',
      matter_id: input.matterId ?? null,
      lead_id: input.leadId ?? null,
      due_at: input.dueAt ?? null,
      estimate_minutes: 20,
    },
    recordType: input.matterId ? 'matter' : 'lead',
    recordId: input.matterId ?? input.leadId ?? undefined,
  }
}

function workflowAction(input: {
  eventKey: string
  type: 'seed_design_sheet' | 'ensure_sla_plan' | 'fire_stage_task' | 'annual_review'
  matterId: string
  summary: string
  payload?: Record<string, unknown>
}): AutomationCandidateAction {
  return {
    eventKey: input.eventKey,
    actionKey: 'workflow.enqueue',
    displaySummary: input.summary,
    referencePayload: {
      type: input.type,
      matterId: input.matterId,
      dedupeKey: input.eventKey,
      payload: input.payload ?? {},
    },
    recordType: 'matter',
    recordId: input.matterId,
  }
}

async function leadCreatedCandidates(rule: AutomationRuleRecord, now: Date): Promise<AutomationCandidate[]> {
  const windowHours = numberCondition(rule.conditions, 'windowHours', 24, 1, 720)
  const { data, error } = await getAdminClient().from('client_intake')
    .select('id, created_at')
    .eq('lead_status', 'lead')
    .gte('created_at', new Date(now.getTime() - windowHours * 3_600_000).toISOString())
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(lead => {
    const eventKey = `lead-created:${lead.id}:${lead.created_at}`
    return {
      candidateKey: eventKey,
      recordType: 'lead' as const,
      recordId: lead.id,
      title: 'New lead intake and follow-up work',
      reason: 'Lead was created inside the configured window',
      href: `/admin/leads/${lead.id}`,
      actions: [taskAction({
        eventKey: `${eventKey}:task`,
        title: 'Send intake and schedule lead follow-up',
        leadId: lead.id,
        dueAt: isoAfter(now, 1),
        description: 'Confirm intake delivery and set the next concrete follow-up.',
      })],
    }
  })
}

async function appointmentCandidates(rule: AutomationRuleRecord, now: Date): Promise<AutomationCandidate[]> {
  const horizonDays = numberCondition(rule.conditions, 'horizonDays', 14, 1, 60)
  const { data, error } = await getAdminClient().from('appointments')
    .select('id, start_time, linked_lead_id, linked_matter_id')
    .eq('status', 'scheduled').gte('start_time', now.toISOString()).lte('start_time', isoAfter(now, horizonDays))
    .order('start_time').limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).filter(row => row.linked_matter_id || row.linked_lead_id).map(row => {
    const eventKey = `appointment:${row.id}:${row.start_time}`
    const matterId = row.linked_matter_id
    const leadId = matterId ? null : row.linked_lead_id
    return {
      candidateKey: eventKey,
      recordType: matterId ? 'matter' as const : 'lead' as const,
      recordId: matterId ?? leadId ?? undefined,
      title: 'Appointment preparation checklist',
      reason: 'A linked appointment is upcoming',
      href: matterId ? `/admin/matters/${matterId}` : `/admin/leads/${leadId}`,
      actions: [taskAction({
        eventKey: `${eventKey}:task`, title: 'Prepare for upcoming appointment', matterId, leadId,
        dueAt: row.start_time, description: 'Review the record and identify missing information before the appointment.',
      })],
    }
  })
}

async function intakeOverdueCandidates(rule: AutomationRuleRecord, now: Date): Promise<AutomationCandidate[]> {
  const overdueDays = numberCondition(rule.conditions, 'overdueDays', 3, 1, 60)
  const { data, error } = await getAdminClient().from('client_intake')
    .select('id, intake_sent_at')
    .eq('lead_status', 'lead').not('intake_sent_at', 'is', null).is('intake_completed_at', null)
    .lte('intake_sent_at', isoBefore(now, overdueDays)).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(lead => {
    const eventKey = `intake-overdue:${lead.id}:${lead.intake_sent_at}`
    return {
      candidateKey: eventKey,
      recordType: 'lead' as const,
      recordId: lead.id,
      title: 'Prepare overdue intake reminder',
      reason: `Intake remains incomplete after ${overdueDays} days`,
      href: `/admin/leads/${lead.id}`,
      actions: [{
        eventKey: `${eventKey}:draft`, actionKey: 'email.draft.prepare',
        displaySummary: 'Prepare intake reminder email',
        referencePayload: { leadId: lead.id, purpose: 'intake_reminder' },
        recordType: 'lead', recordId: lead.id,
      }],
    }
  })
}

async function engagementCandidates(now: Date): Promise<AutomationCandidate[]> {
  const { data, error } = await getAdminClient().from('matters')
    .select('id, engagement_signed_at')
    .not('engagement_signed_at', 'is', null).gte('engagement_signed_at', isoBefore(now, 90)).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(matter => {
    const eventKey = `engagement-signed:${matter.id}:${matter.engagement_signed_at}`
    return {
      candidateKey: eventKey,
      recordType: 'matter' as const,
      recordId: matter.id,
      title: 'Engagement onboarding work',
      reason: 'The engagement date is recorded',
      href: `/admin/matters/${matter.id}`,
      actions: [
        workflowAction({ eventKey: `${eventKey}:seed`, type: 'seed_design_sheet', matterId: matter.id, summary: 'Seed design sheet from verified intake' }),
        workflowAction({ eventKey: `${eventKey}:sla`, type: 'ensure_sla_plan', matterId: matter.id, summary: 'Create onboarding SLA plan' }),
      ],
    }
  })
}

async function stageEnteredCandidates(now: Date): Promise<AutomationCandidate[]> {
  const { data, error } = await getAdminClient().from('matters')
    .select('id, stage, stage_entered_at')
    .not('stage_entered_at', 'is', null).gte('stage_entered_at', isoBefore(now, 30)).limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(matter => {
    const eventKey = `stage-entered:${matter.id}:${matter.stage}:${matter.stage_entered_at}`
    return {
      candidateKey: eventKey,
      recordType: 'matter' as const,
      recordId: matter.id,
      title: 'Seed stage checklist',
      reason: `Matter entered ${matter.stage.replaceAll('_', ' ')}`,
      href: `/admin/matters/${matter.id}?tab=tasks`,
      actions: [workflowAction({
        eventKey, type: 'fire_stage_task', matterId: matter.id,
        summary: 'Seed stage checklist', payload: { stage: matter.stage },
      })],
    }
  })
}

async function staleLeadCandidates(rule: AutomationRuleRecord, now: Date): Promise<AutomationCandidate[]> {
  const staleDays = numberCondition(rule.conditions, 'staleDays', 14, 2, 120)
  const { data, error } = await getAdminClient().from('client_intake')
    .select('id, updated_at').eq('lead_status', 'lead').is('matter_id', null)
    .lte('updated_at', isoBefore(now, staleDays)).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(lead => {
    const eventKey = `lead-stale:${lead.id}:${lead.updated_at}`
    return {
      candidateKey: eventKey,
      recordType: 'lead' as const,
      recordId: lead.id,
      title: 'Prepare stale lead follow-up',
      reason: `Lead has not changed for at least ${staleDays} days`,
      href: `/admin/leads/${lead.id}`,
      actions: [{
        eventKey: `${eventKey}:draft`, actionKey: 'email.draft.prepare',
        displaySummary: 'Prepare stale lead follow-up email',
        referencePayload: { leadId: lead.id, purpose: 'stale_lead_follow_up' },
        recordType: 'lead', recordId: lead.id,
      }],
    }
  })
}

async function unansweredMessageCandidates(now: Date): Promise<AutomationCandidate[]> {
  const { data, error } = await getAdminClient().from('messages')
    .select('id, matter_id, created_at').eq('sender_role', 'client').is('read_at', null)
    .gte('created_at', isoBefore(now, 30)).order('created_at').limit(200)
  if (error) throw new Error(error.message)
  const latest = new Map<string, { id: string; matter_id: string; created_at: string }>()
  for (const row of data ?? []) latest.set(row.matter_id, row)
  return [...latest.values()].map(message => {
    const eventKey = `unanswered-message:${message.matter_id}:${message.id}`
    return {
      candidateKey: eventKey,
      recordType: 'matter' as const,
      recordId: message.matter_id,
      title: 'Follow up on unanswered client message',
      reason: 'A client portal message is still unread',
      href: `/admin/matters/${message.matter_id}?tab=communications`,
      actions: [taskAction({
        eventKey, title: 'Reply to client portal message', matterId: message.matter_id,
        dueAt: isoAfter(now, 1), description: 'Review and respond to the unread client portal message.',
      })],
    }
  })
}

async function signingCandidates(now: Date): Promise<AutomationCandidate[]> {
  const { data, error } = await getAdminClient().from('matters')
    .select('id, documents_executed_at')
    .not('documents_executed_at', 'is', null).gte('documents_executed_at', isoBefore(now, 90)).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(matter => {
    const eventKey = `signing-completed:${matter.id}:${matter.documents_executed_at}`
    return {
      candidateKey: eventKey,
      recordType: 'matter' as const,
      recordId: matter.id,
      title: 'Signing closeout and funding work',
      reason: 'Executed documents are recorded',
      href: `/admin/matters/${matter.id}?tab=tasks`,
      actions: [
        // The job maps a pipeline stage to its engine key; `closeout` is the
        // engine key, and passing it here meant the job mapped nothing and
        // created no task. `post_execution` is the stage whose template it is.
        workflowAction({ eventKey: `${eventKey}:closeout`, type: 'fire_stage_task', matterId: matter.id, summary: 'Create signing closeout work', payload: { stage: 'post_execution' } }),
        workflowAction({ eventKey: `${eventKey}:funding`, type: 'fire_stage_task', matterId: matter.id, summary: 'Create funding work', payload: { stage: 'funding' } }),
      ],
    }
  })
}

async function annualReviewCandidates(now: Date): Promise<AutomationCandidate[]> {
  const cutoff = isoBefore(now, 365)
  const cycle = firmTodayKey(now).slice(0, 4)
  const { data, error } = await getAdminClient().from('matters')
    .select('id, documents_executed_at').not('documents_executed_at', 'is', null)
    .lte('documents_executed_at', cutoff).neq('status', 'closed').limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(matter => {
    const eventKey = `annual-review:${matter.id}:${cycle}`
    return {
      candidateKey: eventKey,
      recordType: 'matter' as const,
      recordId: matter.id,
      title: 'Create annual review plan',
      reason: 'The estate plan is at least one year old',
      href: `/admin/matters/${matter.id}?tab=tasks`,
      actions: [workflowAction({ eventKey, type: 'annual_review', matterId: matter.id, summary: 'Create annual estate plan review' })],
    }
  })
}

async function invoiceCandidates(now: Date): Promise<AutomationCandidate[]> {
  const today = firmTodayKey(now)
  const { count, error } = await getAdminClient().from('invoices').select('id', { count: 'exact', head: true })
    .eq('payer', 'client')
    .in('status', ['issued', 'partial']).not('due_date', 'is', null).lt('due_date', today)
  if (error) throw new Error(error.message)
  if (!count) return []
  const eventKey = `invoice-overdue:${today}`
  return [{
    candidateKey: eventKey,
    recordType: 'firm',
    title: 'Prepare overdue invoice reminders',
    reason: `${count} issued invoice${count === 1 ? ' is' : 's are'} past due`,
    href: '/admin/billing?filter=overdue',
    actions: [{
      eventKey, actionKey: 'billing.reminders.prepare', displaySummary: 'Prepare overdue invoice reminders',
      referencePayload: { cycleKey: today }, recordType: 'firm',
    }],
  }]
}

export async function evaluateAutomationRule(rule: AutomationRuleRecord, now = new Date()): Promise<AutomationCandidate[]> {
  switch (rule.trigger_key) {
    case 'lead_created': return leadCreatedCandidates(rule, now)
    case 'appointment_booked': return appointmentCandidates(rule, now)
    case 'intake_overdue': return intakeOverdueCandidates(rule, now)
    case 'engagement_signed': return engagementCandidates(now)
    case 'stage_entered': return stageEnteredCandidates(now)
    case 'lead_stale': return staleLeadCandidates(rule, now)
    case 'communication_unanswered': return unansweredMessageCandidates(now)
    case 'signing_completed': return signingCandidates(now)
    case 'annual_review_due': return annualReviewCandidates(now)
    case 'invoice_overdue': return invoiceCandidates(now)
  }
}

export function summarizeAutomationCandidates(candidates: AutomationCandidate[]) {
  return candidates.map(candidate => ({
    candidateKey: candidate.candidateKey,
    recordType: candidate.recordType,
    recordId: candidate.recordId ?? null,
    title: candidate.title,
    reason: candidate.reason,
    href: candidate.href,
    actionKeys: candidate.actions.map(action => action.actionKey),
  }))
}
