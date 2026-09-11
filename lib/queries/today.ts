import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchMatterAging, type MatterAgingRow } from '@/lib/queries/pipelineAging'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { computeMatterNextAction, type MatterNextActionKind } from '@/lib/matterNextAction'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { invoiceOverdue } from '@/lib/billing/invoices'
import { fetchDueTasks } from '@/lib/queries/tasks'
import { taskDueGroup, type TaskRow } from '@/lib/tasks/types'
import { listCalendarView, mapCalendarView } from '@/lib/appointments/googleEvents'
import type { PipelineMatter } from '@/types/database'

export interface TodayUnreadThread {
  matter_id: string
  client_name: string | null
  unread_count: number
  latest_at: string | null
}

/** Serializable per-row primary action for the Today queue. */
export interface TodayQueueAction {
  kind: MatterNextActionKind
  label: string
  href: string
}

/** Aging row decorated with everything the queue needs to act inline. */
export interface TodayQueueRow extends MatterAgingRow {
  action: TodayQueueAction | null
  /** Set when the row can be nudged inline by resending the intake invite. */
  nudge_matter_id: string | null
}

export interface TodayAppointment {
  id: string
  matter_id: string | null
  client_name: string | null
  next_appointment: string
  next_appointment_type: string | null
  href: string
  is_all_day: boolean
}

export interface TodayData {
  /** Red/amber (non-snoozed) aging rows, worst first. */
  atRisk: MatterAgingRow[]
  /** At-risk rows where the ball is in the attorney's court. */
  waitingOnYou: TodayQueueRow[]
  /** At-risk rows waiting on the client. */
  waitingOnClient: TodayQueueRow[]
  /** Snoozed aging rows, so Today can wake them without the aging board. */
  snoozed: TodayQueueRow[]
  /** Matters with unread client portal messages, newest first. Live matters only. */
  unreadThreads: TodayUnreadThread[]
  /** Submitted intakes waiting on attorney review. */
  intakeReview: PipelineMatter[]
  /** Matters where the intake questionnaire still needs to be sent. */
  intakeToSend: PipelineMatter[]
  /** Matters with an appointment today (firm timezone), soonest first. */
  appointmentsToday: TodayAppointment[]
  appointmentsError?: boolean
  /** Calendar event ids the Your-day overlay must not show twice. */
  calendarEventIds?: string[]
  /** Open tasks whose effective due date has passed, soonest first. */
  overdueTasks: TaskRow[]
  /** Open tasks due today (firm timezone). */
  tasksDueToday: TaskRow[]
  activeMatterCount: number
  /** Rows the attorney can act on — never counts client-owned aging rows. */
  needsYou: number
  /** Non-snoozed rows with red health, across both arms of the aging view. */
  overdueCount: number
  /** The matter half of `overdueCount`; the rest are leads. */
  overdueMatterCount: number
  /** The lead half of `overdueCount`. */
  overdueLeadCount: number
  /**
   * Money the attorney can clear today. Deliberately a short action list, not
   * a second finance dashboard — the Billing page is that.
   */
  billing: TodayBilling
}

export interface TodayOverdueInvoice {
  id: string
  number: string
  matterId: string
  clientName: string
  balanceCents: number
  daysPastDue: number
}

export interface TodayBilling {
  error?: string | null
  /** Client charges not yet on any invoice. */
  unbilledCount: number
  unbilledCents: number
  /** Issued invoices past their due date with a balance, worst first. */
  overdueInvoices: TodayOverdueInvoice[]
  overdueCents: number
  milestonesReadyCount?: number
  reminderDraftCount?: number
  failedWorkflowJobCount?: number
  paymentExceptionCount?: number
  claimsAwaitingSubmissionCount?: number
  claimsAwaitingReimbursementCount?: number
}

const ACTION_LABEL: Record<MatterNextActionKind, string> = {
  'send-intake': 'Send intake',
  'review-intake': 'Review',
  'draft': 'Draft',
  'send-engagement': 'Send engagement',
  'waiting-intake': 'Resend',
  'waiting-engagement': 'Resend',
  'resolve-review-flags': 'Review flags',
  'closed': 'Documents',
  'review': 'Review drafts',
  'revise': 'Revisions',
  'signing': 'Signing tasks',
  'follow-up': 'Follow-up',
}

function decorateRow(row: MatterAgingRow, matterById: Map<string, PipelineMatter>): TodayQueueRow {
  const matter = row.entity === 'matter' ? matterById.get(row.id) : undefined
  if (!matter) return { ...row, action: null, nudge_matter_id: null }
  const next = computeMatterNextAction(matter)
  return {
    ...row,
    action: { kind: next.kind, label: ACTION_LABEL[next.kind] ?? next.cta, href: next.href },
    nudge_matter_id: next.kind === 'waiting-intake' ? matter.matter_id : null,
  }
}

/**
 * One aggregate read for the attorney's "Today" home page. Reuses the same
 * sources as the sidebar badges but returns actionable rows, not just counts.
 */
export async function fetchTodayData(options: { includeCalendar?: boolean } = {}): Promise<TodayData> {
  const admin = getAdminClient()
  const todayKey = firmTodayKey()
  // A deliberately wide UTC window around firm-local noon. We filter the
  // results by firmDateKey below, so this remains correct across DST changes.
  const firmNoonUtc = Date.parse(`${todayKey}T12:00:00Z`)
  const calendarFrom = new Date(firmNoonUtc - 18 * 60 * 60 * 1000).toISOString()
  const calendarTo = new Date(firmNoonUtc + 18 * 60 * 60 * 1000).toISOString()
  // The same margin, for the same reason: firm noon plus 18 hours is past the
  // end of today at either UTC offset, and `taskDueGroup` does the exact
  // grouping below. Erring wide costs a handful of rows the grouping drops;
  // erring narrow would hide a task that is due.
  const dueThrough = calendarTo

  const [aging, mattersRes, unreadRes, dueTasks, appointmentsRes, billing] = await Promise.all([
    fetchMatterAging(),
    admin
      .from('v_matter_pipeline')
      .select(PIPELINE_MATTER_COLUMNS)
      .neq('status', 'archived')
      .neq('stage', 'closed')
      .order('matter_created', { ascending: false }),
    admin
      .from('messages')
      .select('matter_id, created_at')
      .eq('sender_role', 'client')
      .is('read_at', null),
    fetchDueTasks(dueThrough),
    admin
      .from('appointments')
      .select('id, start_time, status, attendee_name, linked_matter_id, google_event_id, microsoft_event_id, appointment_type_id')
      .gte('start_time', calendarFrom)
      .lt('start_time', calendarTo)
      .eq('status', 'scheduled')
      .order('start_time', { ascending: true }),
    fetchTodayBilling(admin, todayKey),
  ])

  if (mattersRes.error) throw new Error('Today matters are unavailable. Please retry.')
  if (unreadRes.error) throw new Error('Today messages are unavailable. Please retry.')
  if (appointmentsRes.error) console.error('fetchTodayData appointments error:', appointmentsRes.error)

  const matters = (mattersRes.data ?? []) as PipelineMatter[]
  const matterById = new Map(matters.map(m => [m.matter_id, m]))

  const unreadByMatter = new Map<string, TodayUnreadThread>()
  for (const row of (unreadRes.data ?? []) as Array<{ matter_id: string; created_at: string }>) {
    // Only live matters — unread messages on archived/closed matters would
    // otherwise render as "Unnamed matter" linking into a closed matter.
    if (!matterById.has(row.matter_id)) continue
    const current = unreadByMatter.get(row.matter_id)
    if (current) {
      current.unread_count += 1
      if (!current.latest_at || row.created_at > current.latest_at) current.latest_at = row.created_at
    } else {
      unreadByMatter.set(row.matter_id, {
        matter_id: row.matter_id,
        client_name: matterById.get(row.matter_id)?.client_name ?? null,
        unread_count: 1,
        latest_at: row.created_at,
      })
    }
  }
  const unreadThreads = [...unreadByMatter.values()].sort((a, b) =>
    (b.latest_at ?? '').localeCompare(a.latest_at ?? ''),
  )

  const intakeReview = matters.filter(m => m.stage === 'intake_review')
  const intakeToSend = matters.filter(m => computeMatterNextAction(m).kind === 'send-intake')

  const atRisk = aging.rows.filter(row => !row.is_snoozed && row.health !== 'green')
  const waitingOnYou = atRisk.filter(r => r.owner !== 'client').map(r => decorateRow(r, matterById))
  const waitingOnClient = atRisk.filter(r => r.owner === 'client').map(r => decorateRow(r, matterById))
  const snoozed = aging.rows.filter(r => r.is_snoozed).map(r => decorateRow(r, matterById))

  const appointmentRows = (appointmentsRes.data ?? []) as Array<{
    id: string
    start_time: string
    attendee_name: string
    linked_matter_id: string | null
    google_event_id: string | null
    microsoft_event_id: string | null
    appointment_type_id: string | null
  }>
  const appointmentTypeIds = Array.from(
    new Set(appointmentRows.map(row => row.appointment_type_id).filter((id): id is string => Boolean(id))),
  )
  const appointmentTypeById = new Map<string, string>()
  if (appointmentTypeIds.length > 0) {
    const { data, error } = await admin
      .from('appointment_types')
      .select('id, label')
      .in('id', appointmentTypeIds)
    if (error) console.error('fetchTodayData appointment types error:', error)
    for (const row of data ?? []) appointmentTypeById.set(row.id, row.label)
  }

  const appointmentsToday: TodayAppointment[] = appointmentRows
    .filter(row => firmDateKey(row.start_time) === todayKey)
    .map(row => ({
      id: `appointment:${row.id}`,
      matter_id: row.linked_matter_id,
      client_name: row.attendee_name || null,
      next_appointment: row.start_time,
      next_appointment_type: row.appointment_type_id
        ? appointmentTypeById.get(row.appointment_type_id) ?? null
        : null,
      href: row.linked_matter_id ? `/admin/matters/${row.linked_matter_id}` : '/admin/calendar',
      is_all_day: false,
    }))

  const knownMatterAppointmentKeys = new Set(
    appointmentsToday
      .filter(row => row.matter_id)
      .map(row => `${row.matter_id}:${row.next_appointment}`),
  )
  appointmentsToday.push(...matters
    .filter(m => m.next_appointment && firmDateKey(m.next_appointment) === todayKey)
    .filter(m => !knownMatterAppointmentKeys.has(`${m.matter_id}:${m.next_appointment}`))
    .map(m => ({
      id: `matter:${m.matter_id}:${m.next_appointment}`,
      matter_id: m.matter_id,
      client_name: m.client_name ?? null,
      next_appointment: m.next_appointment as string,
      next_appointment_type: m.next_appointment_type ?? null,
      href: `/admin/matters/${m.matter_id}`,
      is_all_day: false,
    })))

  // Calendar-only events are part of the Calendar page and therefore belong on
  // Your day too. Bookings already represented above are excluded by event id.
  if (options.includeCalendar !== false) try {
    const exclude = new Set(
      appointmentRows
        .flatMap(row => [row.google_event_id, row.microsoft_event_id])
        .filter((id): id is string => Boolean(id)),
    )
    const calendarEvents = mapCalendarView(
      (await listCalendarView(calendarFrom, calendarTo)).raw,
      exclude,
    )
    appointmentsToday.push(...calendarEvents
      // An all-day event is a calendar date anchored at UTC midnight; retain
      // that date instead of shifting midnight into yesterday.
      .filter(event =>
        (event.isAllDay ? event.startIso.slice(0, 10) : firmDateKey(event.startIso)) === todayKey,
      )
      .map(event => ({
        id: `calendar:${event.id}`,
        matter_id: null,
        client_name: event.subject,
        next_appointment: event.startIso,
        next_appointment_type: 'Calendar',
        href: '/admin/calendar',
        is_all_day: event.isAllDay,
      })))
  } catch (error) {
    // Today remains useful when the calendar is disconnected or briefly down.
    console.error('fetchTodayData calendar error:', error)
  }
  appointmentsToday.sort((a, b) => a.next_appointment.localeCompare(b.next_appointment))

  // `dueTasks` is already bounded at the end of today, so these two groups
  // between them are the whole read — anything else the boundary let through
  // is due tomorrow and belongs to neither.
  const overdueTasks = dueTasks.filter(task => taskDueGroup(task) === 'overdue')
  const tasksDueToday = dueTasks.filter(task => taskDueGroup(task) === 'today')

  return {
    atRisk,
    waitingOnYou,
    waitingOnClient,
    snoozed,
    unreadThreads,
    intakeReview,
    intakeToSend,
    appointmentsToday,
    appointmentsError: Boolean(appointmentsRes.error),
    calendarEventIds: appointmentRows
      .flatMap(row => [row.google_event_id, row.microsoft_event_id])
      .filter((id): id is string => Boolean(id)),
    overdueTasks,
    tasksDueToday,
    activeMatterCount: matters.length,
    needsYou:
      overdueTasks.length + tasksDueToday.length + waitingOnYou.length + unreadThreads.length
      + intakeReview.length + intakeToSend.length,
    overdueCount: atRisk.filter(r => r.health === 'red').length,
    // Split because the page reported the total as "N matters over SLA" while
    // over a third of it was leads: 59 red rows on 2026-08-24, 27 of them leads.
    overdueMatterCount: atRisk.filter(r => r.health === 'red' && r.entity === 'matter').length,
    overdueLeadCount: atRisk.filter(r => r.health === 'red' && r.entity === 'lead').length,
    billing,
  }
}

const EMPTY_BILLING: TodayBilling = {
  unbilledCount: 0,
  unbilledCents: 0,
  overdueInvoices: [],
  overdueCents: 0,
  milestonesReadyCount: 0,
  reminderDraftCount: 0,
  failedWorkflowJobCount: 0,
  paymentExceptionCount: 0,
  claimsAwaitingSubmissionCount: 0,
  claimsAwaitingReimbursementCount: 0,
}

/**
 * Two billing facts worth acting on today: work that is done but unbilled, and
 * invoices that are late.
 *
 * Best-effort — Today is a queue, not a ledger, so a billing read that fails
 * must not take the whole page down with it.
 */
async function fetchTodayBilling(
  admin: ReturnType<typeof getAdminClient>,
  todayKey: string,
): Promise<TodayBilling> {
  try {
    const [chargeRes, invoiceRes] = await Promise.all([
      admin
        .from('billing_items')
        .select('id, amount_billed, kind, invoice_id, status')
        .is('invoice_id', null)
        .neq('kind', 'plan_claim')
        .neq('status', 'paid'),
      admin
        .from('invoices')
        .select('id, number, matter_id, subtotal_cents, due_date, status, kind')
        .in('status', ['issued', 'partial'])
        .not('due_date', 'is', null)
        .lt('due_date', todayKey),
    ])
    if (chargeRes.error || invoiceRes.error) throw new Error('Billing unavailable')

    const charges = (chargeRes.data ?? []) as { id: string; amount_billed: number }[]
    const invoices = (invoiceRes.data ?? []) as {
      id: string
      number: string | null
      matter_id: string
      subtotal_cents: number
      kind: string
      due_date: string
    }[]

    const supplemental = { ...EMPTY_BILLING }
    const [milestones, reminders, jobs, exceptions, claims] = await Promise.all([
      admin.from('matter_fee_milestones').select('id', { count: 'exact', head: true }).eq('state', 'ready'),
      admin.from('invoice_reminders').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      admin.from('workflow_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      admin.from('billing_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('billing_items').select('status').eq('kind', 'plan_claim').neq('status', 'paid'),
    ])
    if ([milestones, reminders, jobs, exceptions, claims].some(result => result.error)) supplemental.error = 'Some billing attention counts are unavailable. Please retry.'
    supplemental.milestonesReadyCount = milestones.error ? 0 : milestones.count ?? 0
    supplemental.reminderDraftCount = reminders.error ? 0 : reminders.count ?? 0
    supplemental.failedWorkflowJobCount = jobs.error ? 0 : jobs.count ?? 0
    supplemental.paymentExceptionCount = exceptions.error ? 0 : exceptions.count ?? 0
    supplemental.claimsAwaitingSubmissionCount = claims.error ? 0 : (claims.data ?? []).filter(row => row.status === 'to_invoice').length
    supplemental.claimsAwaitingReimbursementCount = claims.error ? 0 : (claims.data ?? []).filter(row => row.status !== 'to_invoice').length

    if (invoices.length === 0) {
      return {
        ...supplemental,
        unbilledCount: charges.length,
        unbilledCents: charges.reduce((sum, row) => sum + row.amount_billed, 0),
      }
    }

    const [balances, pipelineRes] = await Promise.all([
      loadInvoiceBalances(admin, invoices),
      admin
        .from('v_matter_pipeline')
        .select('matter_id, client_name, matter_name')
        .in('matter_id', [...new Set(invoices.map(invoice => invoice.matter_id))]),
    ])

    const nameById = new Map(
      ((pipelineRes.data ?? []) as {
        matter_id: string
        client_name: string | null
        matter_name: string | null
      }[]).map(row => [row.matter_id, row.client_name ?? row.matter_name ?? 'Unknown client']),
    )

    const overdueInvoices = invoices
      .map(invoice => {
        const balanceCents = balances.get(invoice.id)!
        // invoiceOverdue owns the "past due" rule and its calendar arithmetic;
        // re-deriving it here is how the two surfaces would drift apart.
        const { daysPastDue } = invoiceOverdue(
          { status: 'issued', dueDate: invoice.due_date },
          balanceCents,
          todayKey,
        )
        return {
          id: invoice.id,
          number: invoice.number ?? '',
          matterId: invoice.matter_id,
          clientName: nameById.get(invoice.matter_id) ?? 'Unknown client',
          balanceCents,
          daysPastDue,
        }
      })
      .filter(invoice => invoice.balanceCents > 0)
      .sort((a, b) => b.daysPastDue - a.daysPastDue)

    return {
      error: supplemental.error,
      unbilledCount: charges.length,
      unbilledCents: charges.reduce((sum, row) => sum + row.amount_billed, 0),
      overdueInvoices,
      overdueCents: overdueInvoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0),
      milestonesReadyCount: supplemental.milestonesReadyCount,
      reminderDraftCount: supplemental.reminderDraftCount,
      failedWorkflowJobCount: supplemental.failedWorkflowJobCount,
      paymentExceptionCount: supplemental.paymentExceptionCount,
      claimsAwaitingSubmissionCount: supplemental.claimsAwaitingSubmissionCount,
      claimsAwaitingReimbursementCount: supplemental.claimsAwaitingReimbursementCount,
    }
  } catch {
    return { ...EMPTY_BILLING, error: 'Billing is unavailable. Please retry.' }
  }
}
