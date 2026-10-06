import { firmDateKey } from '@/lib/firmDate'
import { buildRows, billingMoney } from '@/lib/billing/metrics'
import type { BillingItem, BillingPayment } from '@/lib/billing/types'

/**
 * The weekly financial snapshot: the pure half.
 *
 * Given the ledger (items and payments) and a week, this works out what the
 * firm collected, billed and spent in that week, where receivables stand as of
 * the Monday after, and how the year is tracking against the goal. The server
 * half stores the row, compares it with the week before, and sends the email.
 *
 * Every date is a `YYYY-MM-DD` key in the firm's calendar. Amounts are cents.
 */

export interface WeekWindow {
  /** The Monday the week began. */
  weekStart: string
  /** The Monday after: exclusive end. */
  weekEnd: string
  /** The Monday the week before began. */
  previousWeekStart: string
  /** "Sep 28 – Oct 4, 2026" */
  label: string
}

const DAY_MS = 86_400_000

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function utcOf(key: string): Date | null {
  const parts = parseKey(key)
  return parts ? new Date(Date.UTC(parts.y, parts.m - 1, parts.d)) : null
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(key: string, days: number): string {
  const date = utcOf(key)
  if (!date) throw new Error(`Not a date key: ${key}`)
  return toKey(new Date(date.getTime() + days * DAY_MS))
}

function shortDate(key: string, withYear: boolean): string {
  const date = utcOf(key)
  if (!date) return key
  return date.toLocaleDateString('en-US', withYear
    ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The Monday on or before the key. */
export function mondayOf(key: string): string {
  const date = utcOf(key)
  if (!date) throw new Error(`Not a date key: ${key}`)
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  return toKey(new Date(date.getTime() - daysSinceMonday * DAY_MS))
}

/** The last complete Monday-to-Sunday week before `todayKey`. On a Monday, that is the week just ended. */
export function lastCompleteWeek(todayKey: string): WeekWindow {
  const weekEnd = mondayOf(todayKey)
  const weekStart = addDays(weekEnd, -7)
  const lastDay = addDays(weekEnd, -1)
  return {
    weekStart,
    weekEnd,
    previousWeekStart: addDays(weekStart, -7),
    label: `${shortDate(weekStart, false)} – ${shortDate(lastDay, true)}`,
  }
}

/** A key for a timestamp (in firm time) or a date key, for comparing against the window. */
function keyOf(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return firmDateKey(value)
}

function within(value: string | null | undefined, start: string, end: string): boolean {
  if (!value) return false
  const key = keyOf(value)
  return key !== null && key >= start && key < end
}

export interface WeeklyFinancialSnapshot {
  weekStart: string
  weekEnd: string
  /** Payments received in the week. */
  collectedCents: number
  paymentCount: number
  /** Payments received in the week before, for the week-over-week line. */
  previousWeekCollectedCents: number
  /** Charges invoiced (or claims submitted) in the week. */
  billedCents: number
  billedCount: number
  /** Costs entered in the week: the firm's outlay, not revenue. */
  costsCents: number
  /** Receivables as of the Monday after. */
  outstandingCents: number
  openCount: number
  overdueCents: number
  overdueCount: number
  aging: { current: number; days31To60: number; days61Plus: number }
  /** Billable work not yet on an invoice (client charges, not claims). */
  toInvoiceCents: number
  toInvoiceCount: number
  /** Plan claims submitted and unpaid. */
  claimsOutstandingCents: number
  claimsOutstandingCount: number
  /** Plan claims entered but not yet submitted. */
  claimsAwaitingCents: number
  claimsAwaitingCount: number
  /** Collections since January 1 of the week's year, against the goal. */
  ytdCollectedCents: number
  goalCents: number
  goalProgressPercent: number
  /** Where year-to-date should be on the last day of the week if the goal were met evenly. */
  paceCents: number
  /** Positive when ahead of pace. */
  paceDeltaCents: number
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** Day-of-year arithmetic for the pace line. */
function yearFraction(key: string): { fraction: number; yearStart: string; yearEnd: string } {
  const date = utcOf(key)
  if (!date) throw new Error(`Not a date key: ${key}`)
  const year = date.getUTCFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd = `${year + 1}-01-01`
  const daysInYear = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS)
  const dayOfYear = Math.round((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1
  return { fraction: dayOfYear / daysInYear, yearStart, yearEnd }
}

/**
 * The snapshot for one week. Receivables are read as of `weekEnd` (the
 * Monday after), which is the morning the email goes out.
 */
export function buildWeeklyFinancialSnapshot(input: {
  items: BillingItem[]
  payments: BillingPayment[]
  window: Pick<WeekWindow, 'weekStart' | 'weekEnd' | 'previousWeekStart'>
  annualGoalCents: number
}): WeeklyFinancialSnapshot {
  const { weekStart, weekEnd, previousWeekStart } = input.window
  const asOf = weekEnd
  const rows = buildRows(input.items, input.payments, asOf)
  const open = rows.filter(row => row.balance > 0)
  const overdue = open.filter(row => row.overdue)

  const weekPayments = input.payments.filter(payment => within(payment.receivedAt, weekStart, weekEnd))
  const previousPayments = input.payments.filter(payment => within(payment.receivedAt, previousWeekStart, weekStart))
  const billed = rows.filter(row => row.kind !== 'cost' && within(row.invoicedAt, weekStart, weekEnd))
  const costs = rows.filter(row => row.kind === 'cost' && within(row.createdAt, weekStart, weekEnd))
  const toInvoice = open.filter(row => row.kind !== 'plan_claim' && row.status === 'to_invoice')
  const claimsOutstanding = open.filter(row => row.kind === 'plan_claim' && row.status !== 'to_invoice')
  const claimsAwaiting = open.filter(row => row.kind === 'plan_claim' && row.status === 'to_invoice')

  const lastDay = addDays(weekEnd, -1)
  const { fraction, yearStart, yearEnd } = yearFraction(lastDay)
  const ytd = sum(input.payments.filter(payment => within(payment.receivedAt, yearStart, yearEnd)).map(payment => payment.amount))
  const goal = Math.max(0, Math.round(input.annualGoalCents))
  const pace = Math.round(goal * fraction)

  return {
    weekStart,
    weekEnd,
    collectedCents: sum(weekPayments.map(payment => payment.amount)),
    paymentCount: new Set(weekPayments.map(payment => payment.paymentGroupId ?? payment.id)).size,
    previousWeekCollectedCents: sum(previousPayments.map(payment => payment.amount)),
    billedCents: sum(billed.map(row => row.amountBilled)),
    billedCount: billed.length,
    costsCents: sum(costs.map(row => row.amountBilled)),
    outstandingCents: sum(open.map(row => row.balance)),
    openCount: open.length,
    overdueCents: sum(overdue.map(row => row.balance)),
    overdueCount: overdue.length,
    aging: {
      current: sum(open.filter(row => row.ageDays <= 30).map(row => row.balance)),
      days31To60: sum(open.filter(row => row.ageDays >= 31 && row.ageDays <= 60).map(row => row.balance)),
      days61Plus: sum(open.filter(row => row.ageDays >= 61).map(row => row.balance)),
    },
    toInvoiceCents: sum(toInvoice.map(row => row.balance)),
    toInvoiceCount: toInvoice.length,
    claimsOutstandingCents: sum(claimsOutstanding.map(row => row.balance)),
    claimsOutstandingCount: claimsOutstanding.length,
    claimsAwaitingCents: sum(claimsAwaiting.map(row => row.balance)),
    claimsAwaitingCount: claimsAwaiting.length,
    ytdCollectedCents: ytd,
    goalCents: goal,
    goalProgressPercent: goal > 0 ? Math.min(100, Math.round((ytd / goal) * 100)) : 0,
    paceCents: pace,
    paceDeltaCents: ytd - pace,
  }
}

export interface Delta {
  cents: number
  /** Null when there was nothing in the earlier period to compare against. */
  percent: number | null
}

export function delta(current: number, previous: number | null | undefined): Delta {
  if (previous === null || previous === undefined) return { cents: current, percent: null }
  const cents = current - previous
  return { cents, percent: previous > 0 ? Math.round((cents / previous) * 100) : null }
}

/** "up 12%", "down 8%", "unchanged", or "" when there is no earlier figure. */
export function describeDelta(value: Delta, options: { goodWhenUp?: boolean } = {}): { text: string; good: boolean | null } {
  if (value.percent === null) {
    if (value.cents === 0) return { text: '', good: null }
    return { text: 'no comparison', good: null }
  }
  if (value.percent === 0) return { text: 'unchanged', good: null }
  const up = value.percent > 0
  const goodWhenUp = options.goodWhenUp ?? true
  return { text: `${up ? 'up' : 'down'} ${Math.abs(value.percent)}%`, good: up === goodWhenUp }
}

export interface SnapshotComparison {
  collected: Delta
  billed: Delta
  outstanding: Delta
  overdue: Delta
}

/** This week against the one before. The previous row is optional: the first snapshot has no history. */
export function compareSnapshots(current: WeeklyFinancialSnapshot, previous: WeeklyFinancialSnapshot | null): SnapshotComparison {
  return {
    collected: delta(current.collectedCents, previous?.collectedCents ?? current.previousWeekCollectedCents),
    billed: delta(current.billedCents, previous?.billedCents),
    outstanding: delta(current.outstandingCents, previous?.outstandingCents),
    overdue: delta(current.overdueCents, previous?.overdueCents),
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The Monday email: a headline, the week, where receivables stand, the year. */
export function composeSnapshotEmail(input: {
  snapshot: WeeklyFinancialSnapshot
  previous: WeeklyFinancialSnapshot | null
  window: WeekWindow
  firmName: string
  billingUrl: string
}): { subject: string; text: string; html: string } {
  const { snapshot, window } = input
  const comparison = compareSnapshots(snapshot, input.previous)
  const collected = describeDelta(comparison.collected)
  const overdue = describeDelta(comparison.overdue, { goodWhenUp: false })
  const money = billingMoney
  const ahead = snapshot.paceDeltaCents >= 0

  const subject = `${input.firmName} week of ${shortDate(window.weekStart, false)}: ${money(snapshot.collectedCents)} collected${collected.text ? ` (${collected.text})` : ''}, ${money(snapshot.outstandingCents)} outstanding`

  const lines: Array<[string, string, string?]> = [
    ['Collected', money(snapshot.collectedCents), `${snapshot.paymentCount} payment${snapshot.paymentCount === 1 ? '' : 's'}${collected.text ? `, ${collected.text} vs the week before` : ''}`],
    ['Billed', money(snapshot.billedCents), `${snapshot.billedCount} charge${snapshot.billedCount === 1 ? '' : 's'} invoiced or submitted`],
    ['Costs entered', money(snapshot.costsCents)],
  ]
  const standing: Array<[string, string, string?]> = [
    ['Outstanding', money(snapshot.outstandingCents), `${snapshot.openCount} open item${snapshot.openCount === 1 ? '' : 's'}`],
    ['Past due', money(snapshot.overdueCents), `${snapshot.overdueCount} item${snapshot.overdueCount === 1 ? '' : 's'}${overdue.text ? `, ${overdue.text} vs the week before` : ''}`],
    ['Aging', `${money(snapshot.aging.current)} current · ${money(snapshot.aging.days31To60)} at 31–60 days · ${money(snapshot.aging.days61Plus)} over 60`],
    ['To invoice', money(snapshot.toInvoiceCents), `${snapshot.toInvoiceCount} client charge${snapshot.toInvoiceCount === 1 ? '' : 's'} not yet billed`],
    ['Plan claims', `${money(snapshot.claimsOutstandingCents)} submitted and unpaid`, `${snapshot.claimsAwaitingCount} claim${snapshot.claimsAwaitingCount === 1 ? '' : 's'} (${money(snapshot.claimsAwaitingCents)}) still to submit`],
  ]
  const year: Array<[string, string, string?]> = [
    ['Collected this year', money(snapshot.ytdCollectedCents), `${snapshot.goalProgressPercent}% of the ${money(snapshot.goalCents)} goal`],
    ['Against pace', `${ahead ? 'Ahead' : 'Behind'} by ${money(Math.abs(snapshot.paceDeltaCents))}`, `the goal implies ${money(snapshot.paceCents)} by ${shortDate(addDays(window.weekEnd, -1), true)}`],
  ]

  const textSection = (title: string, rows: Array<[string, string, string?]>) =>
    [`${title}`, ...rows.map(([label, value, note]) => `  ${label}: ${value}${note ? ` (${note})` : ''}`)].join('\n')
  const text = [
    `Week of ${window.label}`,
    textSection('This week', lines),
    textSection(`Where things stand on ${shortDate(window.weekEnd, true)}`, standing),
    textSection('The year', year),
    `Open Billing: ${input.billingUrl}`,
  ].join('\n\n')

  const htmlSection = (title: string, rows: Array<[string, string, string?]>) => `
    <h3 style="margin:16px 0 6px;font-size:14px">${escapeHtml(title)}</h3>
    <table style="border-collapse:collapse;width:100%">${rows.map(([label, value, note]) => `
      <tr>
        <td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
        <td style="padding:4px 0;vertical-align:top"><strong>${escapeHtml(value)}</strong>${note ? `<span style="color:#555"> · ${escapeHtml(note)}</span>` : ''}</td>
      </tr>`).join('')}
    </table>`
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#222">
    <h2 style="margin:0 0 4px;font-size:16px">Week of ${escapeHtml(window.label)}</h2>
    <p style="margin:0 0 8px;color:#555">${escapeHtml(money(snapshot.collectedCents))} collected${collected.text ? `, ${escapeHtml(collected.text)} vs the week before` : ''}. ${escapeHtml(money(snapshot.outstandingCents))} outstanding, ${escapeHtml(money(snapshot.overdueCents))} past due. ${ahead ? 'Ahead of' : 'Behind'} the annual goal's pace by ${escapeHtml(money(Math.abs(snapshot.paceDeltaCents)))}.</p>
    ${htmlSection('This week', lines)}
    ${htmlSection(`Where things stand on ${shortDate(window.weekEnd, true)}`, standing)}
    ${htmlSection('The year', year)}
    <p style="margin:16px 0 0"><a href="${escapeHtml(input.billingUrl)}" style="color:#1a6b72">Open Billing →</a></p>
  </div>`

  return { subject, text, html }
}

/** The stored row, as the page reads it. */
export interface StoredWeeklySnapshot extends WeeklyFinancialSnapshot {
  id: string
  sentAt: string | null
  emailStatus: string | null
  createdAt: string
}

/** Typed columns plus the whole snapshot, so the page and the email read the same figures. */
export function snapshotToRow(snapshot: WeeklyFinancialSnapshot): Record<string, unknown> {
  return {
    week_start: snapshot.weekStart,
    week_end: snapshot.weekEnd,
    collected_cents: snapshot.collectedCents,
    payment_count: snapshot.paymentCount,
    billed_cents: snapshot.billedCents,
    costs_cents: snapshot.costsCents,
    outstanding_cents: snapshot.outstandingCents,
    open_count: snapshot.openCount,
    overdue_cents: snapshot.overdueCents,
    overdue_count: snapshot.overdueCount,
    ytd_collected_cents: snapshot.ytdCollectedCents,
    goal_cents: snapshot.goalCents,
    metrics: snapshot,
    updated_at: new Date().toISOString(),
  }
}

export function rowToSnapshot(row: Record<string, unknown>): StoredWeeklySnapshot {
  const metrics = (row.metrics && typeof row.metrics === 'object' ? row.metrics : {}) as Partial<WeeklyFinancialSnapshot>
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const weekStart = String(row.week_start).slice(0, 10)
  const weekEnd = String(row.week_end).slice(0, 10)
  const goal = number(row.goal_cents, metrics.goalCents ?? 0)
  const ytd = number(row.ytd_collected_cents, metrics.ytdCollectedCents ?? 0)
  return {
    id: String(row.id),
    weekStart,
    weekEnd,
    collectedCents: number(row.collected_cents, metrics.collectedCents ?? 0),
    paymentCount: number(row.payment_count, metrics.paymentCount ?? 0),
    previousWeekCollectedCents: metrics.previousWeekCollectedCents ?? 0,
    billedCents: number(row.billed_cents, metrics.billedCents ?? 0),
    billedCount: metrics.billedCount ?? 0,
    costsCents: number(row.costs_cents, metrics.costsCents ?? 0),
    outstandingCents: number(row.outstanding_cents, metrics.outstandingCents ?? 0),
    openCount: number(row.open_count, metrics.openCount ?? 0),
    overdueCents: number(row.overdue_cents, metrics.overdueCents ?? 0),
    overdueCount: number(row.overdue_count, metrics.overdueCount ?? 0),
    aging: metrics.aging ?? { current: 0, days31To60: 0, days61Plus: 0 },
    toInvoiceCents: metrics.toInvoiceCents ?? 0,
    toInvoiceCount: metrics.toInvoiceCount ?? 0,
    claimsOutstandingCents: metrics.claimsOutstandingCents ?? 0,
    claimsOutstandingCount: metrics.claimsOutstandingCount ?? 0,
    claimsAwaitingCents: metrics.claimsAwaitingCents ?? 0,
    claimsAwaitingCount: metrics.claimsAwaitingCount ?? 0,
    ytdCollectedCents: ytd,
    goalCents: goal,
    goalProgressPercent: metrics.goalProgressPercent ?? (goal > 0 ? Math.min(100, Math.round((ytd / goal) * 100)) : 0),
    paceCents: metrics.paceCents ?? 0,
    paceDeltaCents: metrics.paceDeltaCents ?? 0,
    sentAt: (row.sent_at as string | null) ?? null,
    emailStatus: (row.email_status as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  }
}

/** A goal from a request body, in cents. Throws with a sentence the form can show. */
export function parseAnnualGoalCents(value: unknown): number {
  const raw = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) throw new Error('The annual goal must be a positive amount')
  const cents = Math.round(raw)
  if (cents > 1_000_000_000_00) throw new Error('The annual goal is too large')
  return cents
}
