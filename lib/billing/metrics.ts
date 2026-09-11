import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type {
  BillingFilter,
  BillingItem,
  BillingLedgerRow,
  BillingNudge,
  BillingPayment,
  BillingSnapshot,
  CollectionsPoint,
  RecentPaymentRow,
  RevenueCategory,
  RevenueRollup,
  UnpreparedClaim,
} from './types'

const DAY_MS = 86_400_000

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/** Formats integer cents for billing surfaces. */
export function billingMoney(cents: number): string {
  return MONEY.format(cents / 100)
}

function dateParts(key: string): [number, number, number] {
  const [year, month, day] = key.split('-').map(Number)
  return [year, month, day]
}

function calendarDaysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = dateParts(from)
  const [toYear, toMonth, toDay] = dateParts(to)
  return Math.max(
    0,
    Math.floor(
      (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay))
      / DAY_MS,
    ),
  )
}

function monthBounds(month: string): { start: string; end: string; priorStart: string; priorEnd: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new Error('selectedMonth must use YYYY-MM')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const key = (date: Date) => date.toISOString().slice(0, 10)
  const startDate = new Date(Date.UTC(year, monthIndex, 1))
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 1))
  const priorStartDate = new Date(Date.UTC(year, monthIndex - 1, 1))
  return {
    start: key(startDate),
    end: key(endDate),
    priorStart: key(priorStartDate),
    priorEnd: key(startDate),
  }
}

function inDateRange(iso: string, start: string, end: string): boolean {
  const key = firmDateKey(iso)
  return key !== null && key >= start && key < end
}

function paymentCompletionDate(
  item: BillingItem,
  payments: BillingPayment[],
): string | null {
  let running = 0
  for (const payment of [...payments].sort(
    (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id),
  )) {
    running += payment.amount
    if (running >= item.amountBilled) return payment.receivedAt
  }
  return null
}

function revenueCategory(item: BillingItem): RevenueCategory | null {
  if (item.legalPlan?.trim()) return 'legal'
  const practice = item.practiceArea?.trim().toLowerCase() ?? ''
  if (practice === 'pb' || practice.includes('probate')) return 'probate'
  const plan = item.planType?.trim().toLowerCase() ?? ''
  if (plan.includes('trust')) return 'trust'
  if (plan.includes('will')) return 'will'
  return null
}

function emptyRollup(): RevenueRollup {
  return { current: 0, prior: 0, count: 0 }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/**
 * Joins payments onto items and derives collected / balance / age / overdue.
 * Exported so matter-scoped views derive rows the same way the firm ledger does.
 */
export function buildRows(
  items: BillingItem[],
  payments: BillingPayment[],
  today: string,
): BillingLedgerRow[] {
  const byItem = new Map<string, BillingPayment[]>()
  for (const payment of payments) {
    const list = byItem.get(payment.billingItemId) ?? []
    list.push(payment)
    byItem.set(payment.billingItemId, list)
  }

  return items
    .map(item => {
      const itemPayments = byItem.get(item.id) ?? []
      const collected = itemPayments.reduce((sum, payment) => sum + payment.amount, 0)
      const balance = Math.max(0, item.amountBilled - collected)
      const ageStart = item.invoicedAt ?? item.createdAt
      const ageKey = firmDateKey(ageStart) ?? today
      const ageDays = item.status === 'paid' ? 0 : calendarDaysBetween(ageKey, today)
      return {
        ...item,
        payments: itemPayments,
        collected,
        balance,
        ageDays,
        // An invoiced charge is late once its invoice's due date has passed.
        // Charges billed before invoices existed have no due date and keep the
        // original net-30-from-invoiced rule.
        overdue: balance > 0 && (
          item.invoiceDueOn
            ? today > item.invoiceDueOn
            : item.invoicedAt !== null && ageDays > 30
        ),
        paidAt: paymentCompletionDate(item, itemPayments),
      }
    })
    .sort((a, b) => {
      const aOpen = a.balance > 0 ? 0 : 1
      const bOpen = b.balance > 0 ? 0 : 1
      if (aOpen !== bOpen) return aOpen - bOpen
      const aDate = a.invoicedAt ?? a.createdAt
      const bDate = b.invoicedAt ?? b.createdAt
      return aDate.localeCompare(bDate) || a.clientName.localeCompare(b.clientName) || a.id.localeCompare(b.id)
    })
}

function buildRevenue(rows: BillingLedgerRow[], today: string): BillingSnapshot['revenue'] {
  const [year, month, day] = dateParts(today)
  const currentStart = `${year}-01-01`
  const currentEnd = today
  const priorStart = `${year - 1}-01-01`
  const priorEnd = `${year - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const result: BillingSnapshot['revenue'] = {
    total: emptyRollup(),
    trust: emptyRollup(),
    will: emptyRollup(),
    probate: emptyRollup(),
    legal: emptyRollup(),
  }

  for (const row of rows) {
    if (row.source !== 'engagement') continue
    const category = revenueCategory(row)
    if (!category) continue
    const created = firmDateKey(row.createdAt)
    if (!created) continue
    if (created >= currentStart && created <= currentEnd) {
      result[category].current += row.amountBilled
      result[category].count += 1
      result.total.current += row.amountBilled
      result.total.count += 1
    } else if (created >= priorStart && created <= priorEnd) {
      result[category].prior += row.amountBilled
      result.total.prior += row.amountBilled
    }
  }
  return result
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function percentDelta(current: number, prior: number): number | null {
  if (prior === 0) return null
  return Math.round(((current - prior) / prior) * 100)
}

/**
 * Six months of collections ending at `selectedMonth`. Anchored on the selected
 * month rather than today so the chart moves with the month picker.
 */
function buildCollectionsTrend(
  payments: BillingPayment[],
  selectedMonth: string,
  months = 6,
): BillingSnapshot['collectionsTrend'] {
  const [year, month] = selectedMonth.split('-').map(Number)
  const points: CollectionsPoint[] = []
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const anchor = new Date(Date.UTC(year, month - 1 - offset, 1))
    const key = anchor.toISOString().slice(0, 7)
    const bounds = monthBounds(key)
    points.push({
      month: key,
      label: MONTH_LABELS[anchor.getUTCMonth()],
      amount: payments
        .filter(payment => inDateRange(payment.receivedAt, bounds.start, bounds.end))
        .reduce((sum, payment) => sum + payment.amount, 0),
    })
  }
  const latest = points.at(-1)
  const previous = points.at(-2)
  return {
    points,
    deltaPercent: latest && previous ? percentDelta(latest.amount, previous.amount) : null,
  }
}

/** Newest payments across every matter, joined back to their ledger row. */
/**
 * One client payment against a multi-charge invoice is stored as one row per
 * charge. Collapse those back into a single entry before taking the top slice —
 * otherwise one $3,240 check would render as three payments and eat three of
 * the eight slots on the card.
 */
function collapsePaymentGroups(payments: BillingPayment[]): BillingPayment[] {
  const groups = new Map<string, BillingPayment[]>()
  const singles: BillingPayment[] = []
  for (const payment of payments) {
    if (!payment.paymentGroupId) {
      singles.push(payment)
      continue
    }
    const list = groups.get(payment.paymentGroupId) ?? []
    list.push(payment)
    groups.set(payment.paymentGroupId, list)
  }
  const merged = [...groups.values()].map(list => {
    // The earliest allocation carries the group: it is the charge the payment
    // was applied to first, so its label reads as the payment's subject.
    const [first, ...rest] = [...list].sort((a, b) => a.id.localeCompare(b.id))
    return rest.length === 0
      ? first
      : { ...first, amount: list.reduce((sum, payment) => sum + payment.amount, 0) }
  })
  return [...singles, ...merged]
}

function buildRecentPayments(
  rows: BillingLedgerRow[],
  payments: BillingPayment[],
  limit = 8,
): RecentPaymentRow[] {
  const rowById = new Map(rows.map(row => [row.id, row]))
  const groupSizes = new Map<string, number>()
  for (const payment of payments) {
    if (!payment.paymentGroupId) continue
    groupSizes.set(payment.paymentGroupId, (groupSizes.get(payment.paymentGroupId) ?? 0) + 1)
  }
  return collapsePaymentGroups(payments)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .flatMap((payment): RecentPaymentRow[] => {
      const row = rowById.get(payment.billingItemId)
      if (!row) return []
      const allocationCount = payment.paymentGroupId
        ? groupSizes.get(payment.paymentGroupId) ?? 1
        : 1
      return [{
        id: payment.id,
        billingItemId: payment.billingItemId,
        matterId: row.matterId,
        clientName: row.clientName,
        matterNumber: row.matterNumber,
        label: row.label,
        kind: row.kind,
        method: payment.method,
        amount: payment.amount,
        receivedAt: payment.receivedAt,
        note: payment.note,
        invoiceNumber: payment.invoiceNumber ?? null,
        allocationCount,
      }]
    })
}

function buildNudges(
  rows: BillingLedgerRow[],
  unpreparedClaims: UnpreparedClaim[],
  dismissed: Set<string>,
  today: string,
): BillingNudge[] {
  const nudges: BillingNudge[] = []
  // One "bill this matter" nudge per matter, not one per charge: the composer
  // groups a matter's open charges onto a single invoice, so three unbilled
  // charges are one job, not three.
  const billable = new Map<string, BillingLedgerRow[]>()

  for (const row of rows) {
    const awaitingClaim = row.kind === 'plan_claim' && row.status === 'to_invoice'
    const awaitingBill = row.kind !== 'plan_claim' && row.status === 'to_invoice'

    if (awaitingClaim) {
      const key = `claim-submit:${row.id}`
      if (!dismissed.has(key)) {
        nudges.push({
          key,
          kind: 'claim_submit',
          clientName: row.clientName,
          description: `Submit ${row.label.toLowerCase()} to the carrier`,
          itemId: row.id,
          matterId: row.matterId,
          clientEmail: row.clientEmail,
          legalPlan: row.plan,
        })
      }
      continue
    }

    // An overdue charge with no invoice predates invoicing (or was flagged by
    // the legacy per-item path). Reminding on it would have nothing to attach,
    // so the useful action is to bill it properly instead.
    if (row.overdue && !row.invoiceId) {
      billable.set(row.matterId, [...(billable.get(row.matterId) ?? []), row])
      continue
    }

    if (awaitingBill) {
      billable.set(row.matterId, [...(billable.get(row.matterId) ?? []), row])
      continue
    }

    if (row.overdue && row.invoiceId) {
      const reminderKey = row.lastRemindedAt ? firmDateKey(row.lastRemindedAt) : null
      const recentlyReminded =
        reminderKey !== null && calendarDaysBetween(reminderKey, today) < 7
      // Keyed on the invoice, so one reminder covers every charge on it rather
      // than nagging once per line.
      const key = `reminder:invoice:${row.invoiceId}`
      if (!recentlyReminded && !dismissed.has(key) && !nudges.some(n => n.key === key)) {
        nudges.push({
          key,
          kind: 'reminder',
          clientName: row.clientName,
          description: row.invoiceNumber
            ? `Invoice ${row.invoiceNumber}, ${row.ageDays} days past due`
            : `Payment reminder, ${row.ageDays} days past due`,
          itemId: row.id,
          matterId: row.matterId,
          clientEmail: row.clientEmail,
          legalPlan: row.plan,
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber ?? null,
        })
      }
    }
  }

  for (const [matterId, matterRows] of billable) {
    const key = `bill:${matterId}`
    if (dismissed.has(key)) continue
    const total = matterRows.reduce((sum, row) => sum + row.balance, 0)
    const [first] = matterRows
    nudges.push({
      key,
      kind: 'bill',
      clientName: first.clientName,
      description: matterRows.length === 1
        ? `Bill ${first.label.toLowerCase()}`
        : `Bill ${matterRows.length} charges (${billingMoney(total)})`,
      itemId: first.id,
      matterId,
      clientEmail: first.clientEmail,
      legalPlan: null,
    })
  }
  for (const claim of unpreparedClaims) {
    const key = `claim:${claim.matterId}:${claim.legalPlan}`
    if (!dismissed.has(key)) {
      nudges.push({
        key,
        kind: 'claim',
        clientName: claim.clientName,
        description: `${claim.legalPlan === 'metlife' ? 'MetLife' : 'LegalEASE'} claim not prepared`,
        itemId: null,
        matterId: claim.matterId,
        clientEmail: claim.clientEmail,
        legalPlan: claim.legalPlan,
      })
    }
  }
  return nudges
}

export function buildBillingSnapshot(input: {
  items: BillingItem[]
  payments: BillingPayment[]
  engagementRevenueItems?: BillingItem[]
  selectedMonth: string
  annualGoalCents: number
  now?: Date
  dismissedNudgeKeys: string[]
  unpreparedClaims: UnpreparedClaim[]
}): BillingSnapshot {
  const now = input.now ?? new Date()
  const today = firmTodayKey(now)
  const rows = buildRows(input.items, input.payments, today)
  const open = rows.filter(row => row.balance > 0)
  const bounds = monthBounds(input.selectedMonth)
  const monthAmount = input.payments
    .filter(payment => inDateRange(payment.receivedAt, bounds.start, bounds.end))
    .reduce((sum, payment) => sum + payment.amount, 0)
  const priorAmount = input.payments
    .filter(payment => inDateRange(payment.receivedAt, bounds.priorStart, bounds.priorEnd))
    .reduce((sum, payment) => sum + payment.amount, 0)
  const yearStart = `${dateParts(today)[0]}-01-01`
  const yearEnd = `${dateParts(today)[0] + 1}-01-01`
  const ytd = input.payments
    .filter(payment => inDateRange(payment.receivedAt, yearStart, yearEnd))
    .reduce((sum, payment) => sum + payment.amount, 0)
  const costsMonth = rows
    .filter(row => row.kind === 'cost' && inDateRange(row.createdAt, bounds.start, bounds.end))
    .reduce((sum, row) => sum + row.amountBilled, 0)
  const costsPriorMonth = rows
    .filter(row => row.kind === 'cost' && inDateRange(row.createdAt, bounds.priorStart, bounds.priorEnd))
    .reduce((sum, row) => sum + row.amountBilled, 0)
  const toInvoice = rows.filter(row => row.status === 'to_invoice')
  const overdue = open.filter(row => row.overdue)
  const paidDurations = rows
    .filter(row => row.paidAt && row.invoicedAt)
    .map(row => ({
      kind: row.kind,
      days: calendarDaysBetween(
        firmDateKey(row.invoicedAt!)!,
        firmDateKey(row.paidAt!)!,
      ),
    }))

  return {
    rows,
    selectedMonth: input.selectedMonth,
    annualGoalCents: input.annualGoalCents,
    revenue: buildRevenue(
      input.engagementRevenueItems
        ? buildRows(input.engagementRevenueItems, [], today)
        : rows,
      today,
    ),
    outstanding: {
      amount: open.reduce((sum, row) => sum + row.balance, 0),
      openCount: open.length,
      overdueAmount: open.filter(row => row.overdue).reduce((sum, row) => sum + row.balance, 0),
    },
    collectedMonth: {
      amount: monthAmount,
      priorAmount,
      deltaPercent: percentDelta(monthAmount, priorAmount),
    },
    collectedYtd: {
      amount: ytd,
      goal: input.annualGoalCents,
      progressPercent: Math.min(100, Math.round((ytd / input.annualGoalCents) * 100)),
    },
    averageDaysToCollect: {
      all: average(paidDurations.map(entry => entry.days)),
      flatFee: average(
        paidDurations.filter(entry => entry.kind === 'flat_fee').map(entry => entry.days),
      ),
      planClaim: average(
        paidDurations.filter(entry => entry.kind === 'plan_claim').map(entry => entry.days),
      ),
    },
    aging: {
      current: open.filter(row => row.ageDays <= 30).reduce((sum, row) => sum + row.balance, 0),
      days31To60: open
        .filter(row => row.ageDays >= 31 && row.ageDays <= 60)
        .reduce((sum, row) => sum + row.balance, 0),
      days61Plus: open.filter(row => row.ageDays >= 61).reduce((sum, row) => sum + row.balance, 0),
    },
    collectionsTrend: buildCollectionsTrend(input.payments, input.selectedMonth),
    costsMonth: {
      amount: costsMonth,
      priorAmount: costsPriorMonth,
      deltaPercent: percentDelta(costsMonth, costsPriorMonth),
    },
    pendingInvoices: {
      amount: toInvoice.reduce((sum, row) => sum + row.balance, 0),
      count: toInvoice.length,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, row) => sum + row.balance, 0),
    },
    recentPayments: buildRecentPayments(rows, input.payments),
    openClaims: open.filter(row => row.kind === 'plan_claim'),
    unpreparedClaims: input.unpreparedClaims,
    nudges: buildNudges(
      rows,
      input.unpreparedClaims,
      new Set(input.dismissedNudgeKeys),
      today,
    ),
  }
}

export function billingStatusPresentation(
  row: BillingLedgerRow,
): {
  label: string
  tone: 'neutral' | 'invoiced' | 'claim' | 'partial' | 'paid' | 'overdue'
} {
  if (row.overdue) return { label: 'Overdue', tone: 'overdue' }
  const presentations = {
    to_invoice: { label: 'To invoice', tone: 'neutral' },
    invoiced: { label: 'Invoiced', tone: 'invoiced' },
    claim_submitted: { label: 'Claim submitted', tone: 'claim' },
    partial: { label: 'Partially paid', tone: 'partial' },
    paid: { label: 'Paid in full', tone: 'paid' },
  } as const
  return presentations[row.status]
}

export function filterBillingRows(
  rows: BillingLedgerRow[],
  filter: BillingFilter,
  search: string,
  selectedMonth: string,
): BillingLedgerRow[] {
  const normalized = search.trim().toLowerCase()
  return rows.filter(row => {
    // Work that still needs billing — a client charge not yet on an invoice.
    // A plan claim is excluded: it goes to the carrier, not onto an invoice.
    if (
      filter === 'to_invoice'
      && (row.invoiceId || row.kind === 'plan_claim' || row.balance === 0)
    ) return false
    if (filter === 'open' && row.balance === 0) return false
    if (filter === 'overdue' && !row.overdue) return false
    if (
      filter === 'paid'
      && (row.balance > 0 || !row.paidAt || !firmDateKey(row.paidAt)?.startsWith(`${selectedMonth}-`))
    ) return false
    if (
      normalized
      && !`${row.clientName} ${row.matterNumber ?? ''} ${row.label}`.toLowerCase().includes(normalized)
    ) return false
    return true
  })
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function billingCsv(rows: BillingLedgerRow[]): string {
  const lines = [
    ['Client', 'Matter', 'Item', 'Billed', 'Collected', 'Balance', 'Status', 'Invoice date', 'Age days'],
    ...rows.map(row => [
      row.clientName,
      row.matterNumber ?? '',
      row.label,
      (row.amountBilled / 100).toFixed(2),
      (row.collected / 100).toFixed(2),
      (row.balance / 100).toFixed(2),
      billingStatusPresentation(row).label,
      row.invoicedAt ? firmDateKey(row.invoicedAt) ?? '' : '',
      row.status === 'paid' ? '' : String(row.ageDays),
    ]),
  ]
  return lines.map(line => line.map(csvCell).join(',')).join('\n')
}
