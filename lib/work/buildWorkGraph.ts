import type { EmailTriageRow } from '@/lib/queries/emailTriage'
import type { SmsThread } from '@/lib/queries/smsThreads'
import type { TodayData, TodayQueueRow } from '@/lib/queries/today'
import { effectiveDueAt, taskDueGroup, type TaskRow } from '@/lib/tasks/types'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
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

export interface WorkGraphSources {
  today: TodayData
  futureTasks?: TaskRow[]
  email?: EmailTriageRow[]
  sms?: SmsThread[]
  failedWorkflowJobs?: FailedWorkflowJob[]
  failedAutomationRuns?: FailedAutomationRun[]
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
  if (row.entity === 'matter' && row.action) return `matter:${row.id}:${row.action.kind}`
  return `${row.entity}:${row.id}:stage:${row.current_stage}`
}

function agingItem(row: TodayQueueRow): WorkItem {
  const href = row.action?.href
    ?? (row.entity === 'matter' ? `/admin/matters/${row.id}` : `/admin/leads/${row.id}`)
  const sourceType: WorkSourceType = row.entity === 'lead' ? 'lead_action' : 'matter_action'
  const waiting = row.owner === 'client'
  const band: PriorityBand = waiting ? 4 : row.health === 'red' ? 1 : 2
  const reasons: PriorityReason[] = waiting
    ? [{ code: 'waiting_external', label: 'Waiting on client' }]
    : [{ code: 'stage_sla', label: row.health === 'red' ? 'Stage is over SLA' : 'Stage is approaching SLA' }]
  return {
    workKey: agingKey(row),
    sourceType,
    sourceIds: [`aging:${row.entity}:${row.id}`],
    evidence: evidence(sourceType, `aging:${row.entity}:${row.id}`, href),
    record: { type: row.entity, id: row.id, name: row.client_name ?? (row.entity === 'lead' ? 'Lead' : 'Matter') },
    title: row.action?.label ?? (row.entity === 'lead' ? 'Review lead next step' : 'Advance matter'),
    actionLabel: row.action?.label ?? 'Open record',
    href,
    owner: waiting ? 'client' : 'firm',
    state: waiting ? 'waiting' : 'open',
    priorityBand: band,
    priorityReasons: reasons,
    estimateMinutes: row.action?.kind === 'draft' ? 60 : row.entity === 'lead' ? 15 : 20,
    actionKey: row.action?.kind ? `matter.${row.action.kind}` : `${row.entity}.review`,
    staleSince: row.stage_entered_at,
    clientWaitingSince: waiting ? undefined : row.stage_entered_at,
  }
}

function messageBand(receivedAt: string, now: Date): PriorityBand {
  return now.getTime() - Date.parse(receivedAt) >= 4 * 60 * 60 * 1000 ? 1 : 2
}

function emailItem(row: EmailTriageRow, now: Date): WorkItem {
  const href = `/admin/email-triage?thread=${encodeURIComponent(row.id)}`
  const record = row.matter_id
    ? { type: 'matter' as const, id: row.matter_id, name: row.sender_name ?? row.sender_email }
    : row.client_intake_id
      ? { type: 'lead' as const, id: row.client_intake_id, name: row.sender_name ?? row.sender_email }
      : { type: 'firm' as const, name: row.sender_name ?? row.sender_email }
  return {
    workKey: `email:${row.id}:reply`,
    sourceType: 'email',
    sourceIds: [row.id],
    evidence: evidence('email', row.id, href),
    record,
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
): WorkGraphResult {
  const todayKey = firmTodayKey(now)
  const items: WorkItem[] = []
  const tasks = [...sources.today.overdueTasks, ...sources.today.tasksDueToday, ...(sources.futureTasks ?? [])]
  const seenTasks = new Set<string>()
  for (const task of tasks) {
    if (seenTasks.has(task.id)) continue
    seenTasks.add(task.id)
    const group = taskDueGroup(task, now)
    if (group === 'later' && effectiveDueAt(task)) {
      const dueKey = firmDateKey(effectiveDueAt(task)!)
      if (!dueKey || businessDaysBetween(todayKey, dueKey) > 3) continue
    }
    items.push(taskItem(task, todayKey))
  }

  items.push(...sources.today.waitingOnYou.map(agingItem))
  items.push(...sources.today.waitingOnClient.map(agingItem))
  items.push(...sources.today.snoozed.map(row => ({
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

  for (const matter of sources.today.intakeToSend) {
    const href = `/admin/matters/${matter.matter_id}`
    items.push({
      workKey: `matter:${matter.matter_id}:send-intake`,
      sourceType: 'matter_action',
      sourceIds: [matter.matter_id],
      evidence: evidence('matter_action', matter.matter_id, href),
      record: { type: 'matter', id: matter.matter_id, name: matter.client_name ?? matter.matter_name ?? 'Matter' },
      title: 'Send intake questionnaire',
      actionLabel: 'Send intake',
      href,
      owner: 'firm',
      state: 'open',
      priorityBand: 1,
      priorityReasons: [{ code: 'intake_unsent', label: 'Intake has not been sent' }],
      estimateMinutes: 10,
      actionKey: 'matter.send-intake',
      staleSince: matter.matter_created ?? undefined,
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
      workKey: `appointment:${appointment.id}:prepare`,
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

  items.push(...(sources.email ?? []).map(row => emailItem(row, now)))
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
