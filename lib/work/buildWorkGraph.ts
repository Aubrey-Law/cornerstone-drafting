import type { EmailTriageRow } from '@/lib/queries/emailTriage'
import type { SmsThread } from '@/lib/queries/smsThreads'
import type { TodayData, TodayQueueRow } from '@/lib/queries/today'
import { effectiveDueAt, taskDueGroup, type TaskRow } from '@/lib/tasks/types'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { appointmentPreparationWorkKey } from '@/lib/work/appointmentPresentation'
import { businessDaysBetween, dedupeWorkItems, applyWorkOverrides } from '@/lib/work/ranking'
import type {
  PriorityBand,
  PriorityReason,
  WorkGraphResult,
  WorkItem,
  WorkItemOverride,
  WorkSourceType,
} from '@/lib/work/types'

export interface FailedWorkflowJob {
  id: string
  matter_id: string | null
  job_type: string
  updated_at: string
}

export interface FailedAutomationRun {
  id: string
  rule_id: string | null
  system_key: string | null
  error_summary: string | null
  started_at: string
}

export interface DocumentReviewSource {
  matterId: string
  matterName: string
  intakeCount: number
  portalCount: number
}

export interface WorkGraphSources {
  today: TodayData
  futureTasks?: TaskRow[]
  email?: EmailTriageRow[]
  sms?: SmsThread[]
  failedWorkflowJobs?: FailedWorkflowJob[]
  failedAutomationRuns?: FailedAutomationRun[]
  documentReviews?: DocumentReviewSource[]
  overrides?: WorkItemOverride[]
  sourceErrors?: string[]
}

function evidence(sourceType: WorkSourceType, sourceId: string, href: string) {
  return [{ sourceType, sourceId, href }]
}

function recordForTask(task: TaskRow): WorkItem['record'] {
  if (task.matter_id) return { type: 'matter', id: task.matter_id, name: task.record_name ?? 'Matter' }
  if (task.lead_id) return { type: 'lead', id: task.lead_id, name: task.record_name ?? 'Lead' }
  return { type: 'firm', name: 'Firm' }
}

function hrefForTask(task: TaskRow): string {
  if (task.matter_id) return `/admin/matters/${task.matter_id}?tab=tasks`
  if (task.lead_id) return `/admin/leads/${task.lead_id}?tab=tasks`
  return '/admin/tasks'
}

function taskReasons(task: TaskRow, todayKey: string): { band: PriorityBand; reasons: PriorityReason[] } {
  if (task.status === 'blocked') {
    return { band: 4, reasons: [{ code: 'blocked', label: 'Blocked' }] }
  }
  const due = effectiveDueAt(task)
  const dueKey = due ? firmDateKey(due) : null
  const hardOverdue = Boolean(task.hard_due_at && firmDateKey(task.hard_due_at)! < todayKey)
  if (hardOverdue) {
    return { band: 0, reasons: [{ code: 'hard_deadline_overdue', label: 'Hard deadline overdue' }] }
  }
  if (dueKey && dueKey < todayKey) {
    const reasons: PriorityReason[] = [{ code: 'due_overdue', label: 'Overdue' }]
    if (task.priority === 'high') reasons.push({ code: 'high_priority', label: 'High priority' })
    return { band: 1, reasons }
  }
  if (dueKey === todayKey) {
    const reasons: PriorityReason[] = [{ code: 'due_today', label: 'Due today' }]
    if (task.priority === 'high') reasons.push({ code: 'high_priority', label: 'High priority' })
    return { band: 1, reasons }
  }
  if (dueKey && businessDaysBetween(todayKey, dueKey) <= 3) {
    return { band: 2, reasons: [{ code: 'due_soon', label: 'Due within 3 business days' }] }
  }
  return { band: 3, reasons: [{ code: 'planned', label: 'Planned work' }] }
}

function taskItem(task: TaskRow, todayKey: string): WorkItem {
  const href = hrefForTask(task)
  const ranked = taskReasons(task, todayKey)
  return {
    workKey: `task:${task.id}`,
    sourceType: 'task',
    sourceIds: [task.id],
    evidence: evidence('task', task.id, href),
    record: recordForTask(task),
    title: task.title,
    actionLabel: task.status === 'in_progress' ? 'Continue task' : 'Start task',
    href,
    owner: task.owner,
    state: task.status === 'blocked' ? 'blocked' : task.owner === 'firm' ? 'open' : 'waiting',
    priorityBand: task.owner === 'firm' ? ranked.band : 4,
    priorityReasons: task.owner === 'firm'
      ? ranked.reasons
      : [{ code: 'waiting_external', label: `Waiting on ${task.owner}` }],
    dueAt: effectiveDueAt(task) ?? undefined,
    hardDueAt: task.hard_due_at ?? undefined,
    estimateMinutes: task.estimate_minutes ?? 30,
    batchTag: task.batch_tag ?? undefined,
    actionKey: task.status === 'in_progress' ? 'task.continue' : 'task.start',
    staleSince: task.updated_at,
    taskPriority: task.priority,
  }
}

function agingKey(row: TodayQueueRow): string {
  if (row.action) return `${row.entity}:${row.id}:${row.action.kind}`
  return `${row.entity}:${row.id}:stage:${row.current_stage}`
}

function agingItem(row: TodayQueueRow): WorkItem {
  const href = row.action?.href
    ?? (row.entity === 'matter' ? `/admin/matters/${row.id}` : `/admin/leads/${row.id}`)
  const sourceType: WorkSourceType = row.entity === 'lead' ? 'lead_action' : 'matter_action'
  const waiting = row.owner === 'client'
  const actionKind = row.action?.kind ?? null
  const draftingStuck = !waiting && actionKind === 'draft' && row.health === 'red' && (row.days_over_sla ?? 0) >= 3
  const signingPrep = !waiting && actionKind === 'signing'
  let band: PriorityBand = waiting ? 4 : row.health === 'red' ? 1 : 2
  if (draftingStuck) band = 0
  else if (signingPrep && band > 1) band = 1
  const reasons: PriorityReason[] = waiting
    ? [{ code: 'waiting_external', label: 'Waiting on client' }]
    : draftingStuck
      ? [{ code: 'drafting_overdue', label: 'Drafting is overdue' }, { code: 'stage_sla', label: 'Stage is over SLA' }]
      : signingPrep
        ? [{ code: 'signing_prep', label: 'Signing preparation' }, { code: 'stage_sla', label: row.health === 'red' ? 'Stage is over SLA' : 'Stage is approaching SLA' }]
        : [{ code: 'stage_sla', label: row.health === 'red' ? 'Stage is over SLA' : 'Stage is approaching SLA' }]
  return {
    workKey: agingKey(row),
    sourceType,
    sourceIds: [`aging:${row.entity}:${row.id}`],
    evidence: evidence(sourceType, `aging:${row.entity}:${row.id}`, href),
    record: { type: row.entity, id: row.id, name: row.client_name ?? (row.entity === 'lead' ? 'Lead' : 'Matter') },
    title: row.action?.title ?? row.action?.label ?? (row.entity === 'lead' ? 'Review lead next step' : 'Advance matter'),
    actionLabel: row.action?.label ?? 'Open record',
    href,
    owner: waiting ? 'client' : 'firm',
    state: waiting ? 'waiting' : 'open',
    priorityBand: band,
    priorityReasons: reasons,
    estimateMinutes: actionKind === 'draft' || actionKind === 'signing' ? 60 : row.entity === 'lead' ? 15 : 20,
    actionKey: actionKind ? `${row.entity}.${actionKind}` : `${row.entity}.review`,
    staleSince: row.stage_entered_at,
    clientWaitingSince: waiting ? undefined : row.stage_entered_at,
  }
}

function messageBand(receivedAt: string, now: Date): PriorityBand {
  return now.getTime() - Date.parse(receivedAt) >= 4 * 60 * 60 * 1000 ? 1 : 2
}

function emailRecord(row: EmailTriageRow): WorkItem['record'] {
  if (row.matter_id) {
    return { type: 'matter', id: row.matter_id, name: row.sender_name ?? row.sender_email }
  }
  if (row.client_intake_id) {
    return { type: 'lead', id: row.client_intake_id, name: row.sender_name ?? row.sender_email }
  }
  return { type: 'firm', name: row.sender_name ?? row.sender_email }
}

function isActivelySnoozed(row: EmailTriageRow, now: Date): boolean {
  return Boolean(row.snoozed_until && Date.parse(row.snoozed_until) > now.getTime())
}

function emailItem(row: EmailTriageRow, now: Date): WorkItem {
  const href = `/admin/email-triage?thread=${encodeURIComponent(row.id)}`
  return {
    workKey: `email:${row.id}:reply`,
    sourceType: 'email',
    sourceIds: [row.id],
    evidence: evidence('email', row.id, href),
    record: emailRecord(row),
    title: row.subject?.trim() || `Reply to ${row.sender_name ?? row.sender_email}`,
    actionLabel: row.status === 'drafted' ? 'Review draft' : 'Reply',
    href,
    owner: 'firm',
    state: 'open',
    priorityBand: messageBand(row.received_at, now),
    priorityReasons: [
      { code: 'client_waiting', label: 'Sender is waiting' },
      { code: 'unread_inbound', label: 'Needs an email reply' },
    ],
    estimateMinutes: 10,
    batchTag: 'communications',
    actionKey: 'communication.email.reply',
    clientWaitingSince: row.received_at,
  }
}

/** Overdue "remind me if no reply" items after the firm already answered. */
function emailFollowUpItem(row: EmailTriageRow, now: Date): WorkItem {
  const href = `/admin/email-triage?thread=${encodeURIComponent(row.id)}&view=follow_up`
  return {
    workKey: `email:${row.id}:follow_up`,
    sourceType: 'email',
    sourceIds: [row.id],
    evidence: evidence('email', row.id, href),
    record: emailRecord(row),
    title: row.subject?.trim()
      ? `Follow up: ${row.subject.trim()}`
      : `Follow up with ${row.sender_name ?? row.sender_email}`,
    actionLabel: 'Check follow-up',
    href,
    owner: 'firm',
    state: 'open',
    priorityBand: messageBand(row.follow_up_at ?? row.received_at, now),
    priorityReasons: [
      { code: 'follow_up_due', label: 'Email follow-up is due' },
    ],
    estimateMinutes: 10,
    batchTag: 'communications',
    actionKey: 'communication.email.reply',
    clientWaitingSince: row.follow_up_at ?? undefined,
  }
}

function smsItem(row: SmsThread, now: Date): WorkItem {
  const href = `/admin/texts?phone=${encodeURIComponent(row.phone)}`
  const record = row.matterId
    ? { type: 'matter' as const, id: row.matterId, name: row.name ?? row.phoneE164 }
    : row.leadId
      ? { type: 'lead' as const, id: row.leadId, name: row.name ?? row.phoneE164 }
      : { type: 'firm' as const, name: row.name ?? row.phoneE164 }
  return {
    workKey: `sms:${row.phone}:reply`,
    sourceType: 'sms',
    sourceIds: [row.phone],
    evidence: evidence('sms', row.phone, href),
    record,
    title: `Reply to ${row.name ?? row.phoneE164}`,
    actionLabel: 'Reply by text',
    href,
    owner: 'firm',
    state: 'open',
    priorityBand: messageBand(row.lastMessageAt, now),
    priorityReasons: [
      { code: 'client_waiting', label: 'Sender is waiting' },
      { code: 'unread_inbound', label: `${row.unreadCount} unread text${row.unreadCount === 1 ? '' : 's'}` },
    ],
    estimateMinutes: 10,
    batchTag: 'communications',
    actionKey: 'communication.sms.reply',
    clientWaitingSince: row.lastMessageAt,
  }
}

export function buildWorkGraph(
  sources: WorkGraphSources,
  now: Date = new Date(),
  options: { futureBusinessDays?: number } = {},
): WorkGraphResult {
  const todayKey = firmTodayKey(now)
  const futureBusinessDays = options.futureBusinessDays ?? 3
  const items: WorkItem[] = []
  const tasks = [...sources.today.overdueTasks, ...sources.today.tasksDueToday, ...(sources.futureTasks ?? [])]
  const seenTasks = new Set<string>()
  for (const task of tasks) {
    if (seenTasks.has(task.id)) continue
    seenTasks.add(task.id)
    const group = taskDueGroup(task, now)
    if (group === 'later' && effectiveDueAt(task)) {
      const dueKey = firmDateKey(effectiveDueAt(task)!)
      if (!dueKey || businessDaysBetween(todayKey, dueKey) > futureBusinessDays) continue
    }
    items.push(taskItem(task, todayKey))
  }

  const currentMatterWork = (row: (typeof sources.today.waitingOnYou)[number]) => row.entity !== 'matter' || !['send-intake', 'waiting-intake'].includes(row.action?.kind ?? '')
  items.push(...sources.today.waitingOnYou.filter(currentMatterWork).map(agingItem))
  items.push(...sources.today.waitingOnClient.filter(currentMatterWork).map(agingItem))
  items.push(...sources.today.snoozed.filter(currentMatterWork).map(row => ({
    ...agingItem(row),
    state: 'snoozed' as const,
    priorityBand: 4 as const,
    priorityReasons: [{ code: 'snoozed' as const, label: 'Snoozed' }],
  })))

  for (const thread of sources.today.unreadThreads) {
    const href = `/admin/matters/${thread.matter_id}?tab=communications`
    items.push({
      workKey: `matter:${thread.matter_id}:portal-reply`,
      sourceType: 'portal_message',
      sourceIds: [thread.matter_id],
      evidence: evidence('portal_message', thread.matter_id, href),
      record: { type: 'matter', id: thread.matter_id, name: thread.client_name ?? 'Matter' },
      title: `Reply to ${thread.client_name ?? 'client'}`,
      actionLabel: 'Open portal messages',
      href,
      owner: 'firm',
      state: 'open',
      priorityBand: thread.latest_at ? messageBand(thread.latest_at, now) : 2,
      priorityReasons: [
        { code: 'client_waiting', label: 'Client is waiting' },
        { code: 'unread_inbound', label: `${thread.unread_count} unread portal message${thread.unread_count === 1 ? '' : 's'}` },
      ],
      estimateMinutes: 10,
      batchTag: 'communications',
      actionKey: 'communication.portal.reply',
      clientWaitingSince: thread.latest_at ?? undefined,
    })
  }

  for (const matter of sources.today.intakeReview) {
    const href = `/admin/drafting/${matter.matter_id}`
    items.push({
      workKey: `matter:${matter.matter_id}:review-intake`,
      sourceType: 'intake_review',
      sourceIds: [matter.matter_id],
      evidence: evidence('intake_review', matter.matter_id, href),
      record: { type: 'matter', id: matter.matter_id, name: matter.client_name ?? matter.matter_name ?? 'Matter' },
      title: 'Review submitted intake',
      actionLabel: 'Review intake',
      href,
      owner: 'firm',
      state: 'open',
      priorityBand: 1,
      priorityReasons: [{ code: 'intake_ready', label: 'Client finished the intake' }],
      estimateMinutes: 20,
      actionKey: 'matter.review-intake',
      staleSince: matter.matter_created ?? undefined,
    })
  }

  for (const matter of sources.documentReviews ?? []) {
    const total = matter.intakeCount + matter.portalCount
    if (total <= 0) continue
    const href = `/admin/matters/${matter.matterId}?tab=documents`
    items.push({
      workKey: `matter:${matter.matterId}:review-uploads`,
      sourceType: 'document_review',
      sourceIds: [matter.matterId],
      evidence: evidence('document_review', matter.matterId, href),
      record: { type: 'matter', id: matter.matterId, name: matter.matterName },
      title: `Review ${total} new client upload${total === 1 ? '' : 's'}`,
      actionLabel: 'Review documents',
      href,
      owner: 'firm',
      state: 'open',
      priorityBand: 1,
      priorityReasons: [{ code: 'document_review_ready', label: 'Client documents await review' }],
      estimateMinutes: 20,
      actionKey: 'matter.review-documents',
    })
  }

  for (const appointment of sources.today.appointmentsToday) {
    // A free/busy interval protects the suggested schedule, but has no title,
    // client, or legal context and therefore cannot justify a preparation task.
    if (appointment.id.startsWith('calendar-busy:')) continue
    const starts = Date.parse(appointment.next_appointment)
    if (Number.isNaN(starts) || starts < now.getTime()) continue
    const hours = (starts - now.getTime()) / 3_600_000
    const sourceId = appointment.id.replace(/^appointment:/, '')
    items.push({
      workKey: appointmentPreparationWorkKey(appointment),
      sourceType: 'appointment_prep',
      sourceIds: [sourceId],
      evidence: evidence('appointment_prep', sourceId, appointment.href),
      record: appointment.matter_id
        ? { type: 'matter', id: appointment.matter_id, name: appointment.client_name ?? 'Matter' }
        : { type: 'firm', name: appointment.client_name ?? 'Calendar event' },
      title: `Prepare for ${appointment.next_appointment_type ?? appointment.client_name ?? 'appointment'}`,
      actionLabel: 'Prepare',
      href: appointment.href,
      owner: 'firm',
      state: 'open',
      priorityBand: hours <= 24 ? 0 : 1,
      priorityReasons: [{ code: 'appointment_soon', label: hours <= 24 ? 'Appointment within 24 hours' : 'Appointment within 48 hours' }],
      dueAt: appointment.next_appointment,
      estimateMinutes: 20,
      actionKey: 'appointment.prepare',
      appointmentAt: appointment.next_appointment,
    })
  }

  const nowMs = now.getTime()
  for (const row of sources.email ?? []) {
    if (isActivelySnoozed(row, now)) continue
    const followUpDue = row.follow_up_at && Date.parse(row.follow_up_at) <= nowMs
      && (row.status === 'replied' || row.status === 'approved' || row.status === 'dismissed')
    if (followUpDue) {
      items.push(emailFollowUpItem(row, now))
      continue
    }
    if (['needs_reply', 'drafting', 'drafted', 'failed', 'approved'].includes(row.status)) {
      items.push(emailItem(row, now))
    }
  }
  items.push(...(sources.sms ?? []).filter(row => row.unreadCount > 0 && row.lastDirection === 'inbound').map(row => smsItem(row, now)))

  for (const invoice of sources.today.billing.overdueInvoices) {
    const href = `/admin/matters/${invoice.matterId}?tab=billing`
    items.push({
      workKey: `invoice:${invoice.id}:follow-up`,
      sourceType: 'billing',
      sourceIds: [invoice.id],
      evidence: evidence('billing', invoice.id, href),
      record: { type: 'matter', id: invoice.matterId, name: invoice.clientName },
      title: `Follow up on invoice ${invoice.number}`,
      actionLabel: 'Review invoice',
      href,
      owner: 'firm',
      state: 'open',
      priorityBand: invoice.daysPastDue >= 30 ? 1 : 2,
      priorityReasons: [{ code: 'billing_overdue', label: `${invoice.daysPastDue} days past due` }],
      estimateMinutes: 15,
      batchTag: 'billing',
      actionKey: 'billing.invoice.follow-up',
    })
  }

  const billing = sources.today.billing
  if (billing.unbilledCount > 0) {
    items.push({
      workKey: 'billing:unbilled:to-invoice',
      sourceType: 'billing',
      sourceIds: ['unbilled'],
      evidence: evidence('billing', 'unbilled', '/admin/billing?filter=to_invoice'),
      record: { type: 'firm', name: 'Billing' },
      title: `Invoice ${billing.unbilledCount} unbilled charge${billing.unbilledCount === 1 ? '' : 's'}`,
      actionLabel: 'Open billing',
      href: '/admin/billing?filter=to_invoice',
      owner: 'firm',
      state: 'open',
      priorityBand: 2,
      priorityReasons: [{ code: 'billing_unbilled', label: 'Unbilled work waiting' }],
      estimateMinutes: 20,
      batchTag: 'billing',
      actionKey: 'billing.unbilled.review',
    })
  }
  if ((billing.milestonesReadyCount ?? 0) > 0) {
    const count = billing.milestonesReadyCount ?? 0
    items.push({
      workKey: 'billing:milestones:ready',
      sourceType: 'billing',
      sourceIds: ['milestones'],
      evidence: evidence('billing', 'milestones', '/admin/billing?filter=milestones'),
      record: { type: 'firm', name: 'Billing' },
      title: `Bill ${count} ready fee milestone${count === 1 ? '' : 's'}`,
      actionLabel: 'Open milestones',
      href: '/admin/billing?filter=milestones',
      owner: 'firm',
      state: 'open',
      priorityBand: 2,
      priorityReasons: [{ code: 'billing_ready', label: 'Fee milestones ready' }],
      estimateMinutes: 15,
      batchTag: 'billing',
      actionKey: 'billing.milestones.review',
    })
  }
  if ((billing.reminderDraftCount ?? 0) > 0) {
    const count = billing.reminderDraftCount ?? 0
    items.push({
      workKey: 'billing:reminders:approve',
      sourceType: 'billing',
      sourceIds: ['reminders'],
      evidence: evidence('billing', 'reminders', '/admin/billing?filter=reminders'),
      record: { type: 'firm', name: 'Billing' },
      title: `Approve ${count} invoice reminder draft${count === 1 ? '' : 's'}`,
      actionLabel: 'Review reminders',
      href: '/admin/billing?filter=reminders',
      owner: 'firm',
      state: 'open',
      priorityBand: 1,
      priorityReasons: [{ code: 'billing_reminder', label: 'Reminder drafts waiting' }],
      estimateMinutes: 10,
      batchTag: 'billing',
      actionKey: 'billing.reminders.review',
    })
  }
  if ((billing.paymentExceptionCount ?? 0) > 0) {
    const count = billing.paymentExceptionCount ?? 0
    items.push({
      workKey: 'billing:exceptions',
      sourceType: 'billing',
      sourceIds: ['exceptions'],
      evidence: evidence('billing', 'exceptions', '/admin/billing?filter=exceptions'),
      record: { type: 'firm', name: 'Billing' },
      title: `Resolve ${count} payment exception${count === 1 ? '' : 's'}`,
      actionLabel: 'Open exceptions',
      href: '/admin/billing?filter=exceptions',
      owner: 'firm',
      state: 'open',
      priorityBand: 1,
      priorityReasons: [{ code: 'billing_overdue', label: 'Payment exceptions' }],
      estimateMinutes: 15,
      batchTag: 'billing',
      actionKey: 'billing.exceptions.review',
    })
  }
  const claimsWaiting = (billing.claimsAwaitingSubmissionCount ?? 0) + (billing.claimsAwaitingReimbursementCount ?? 0)
  if (claimsWaiting > 0) {
    items.push({
      workKey: 'billing:plan-claims',
      sourceType: 'billing',
      sourceIds: ['plan-claims'],
      evidence: evidence('billing', 'plan-claims', '/admin/billing?filter=plan_claims'),
      record: { type: 'firm', name: 'Billing' },
      title: `Advance ${claimsWaiting} plan claim${claimsWaiting === 1 ? '' : 's'}`,
      actionLabel: 'Open claims',
      href: '/admin/billing?filter=plan_claims',
      owner: 'firm',
      state: 'open',
      priorityBand: 2,
      priorityReasons: [{ code: 'billing_ready', label: 'Plan claims need attention' }],
      estimateMinutes: 20,
      batchTag: 'billing',
      actionKey: 'billing.claims.review',
    })
  }

  for (const job of sources.failedWorkflowJobs ?? []) {
    const href = job.matter_id ? `/admin/matters/${job.matter_id}` : '/admin/automations'
    items.push({
      workKey: `workflow-job:${job.id}:retry`,
      sourceType: 'automation_failure',
      sourceIds: [job.id],
      evidence: evidence('automation_failure', job.id, href),
      record: job.matter_id
        ? { type: 'matter', id: job.matter_id, name: 'Matter' }
        : { type: 'firm', name: 'Firm automation' },
      title: `Automation failed: ${job.job_type.replaceAll('_', ' ')}`,
      actionLabel: 'Review failure',
      href,
      owner: 'firm',
      state: 'open',
      priorityBand: job.matter_id ? 0 : 1,
      priorityReasons: [{ code: 'automation_failed', label: job.matter_id ? 'Client work may be affected' : 'Automation needs attention' }],
      estimateMinutes: 15,
      actionKey: 'automation.retry',
      staleSince: job.updated_at,
    })
  }

  for (const run of sources.failedAutomationRuns ?? []) {
    const label = run.system_key?.replaceAll('_', ' ') ?? 'rule automation'
    items.push({
      workKey: `automation-run:${run.id}:review`,
      sourceType: 'automation_failure',
      sourceIds: [run.id],
      evidence: evidence('automation_failure', run.id, '/admin/automations'),
      record: { type: 'firm', name: 'Firm automation' },
      title: `Automation failed: ${label}`,
      actionLabel: 'Review failure',
      href: '/admin/automations',
      owner: 'firm',
      state: 'open',
      priorityBand: 1,
      priorityReasons: [{ code: 'automation_failed', label: run.error_summary?.slice(0, 120) || 'Automation needs attention' }],
      estimateMinutes: 15,
      actionKey: 'automation.review-failure',
      staleSince: run.started_at,
    })
  }

  const deduped = dedupeWorkItems(items)
  return {
    generatedAt: now.toISOString(),
    items: applyWorkOverrides(deduped, sources.overrides ?? [], now),
    appointments: sources.today.appointmentsToday,
    sourceErrors: sources.sourceErrors ?? [],
  }
}
