import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildWeeklyFinancialSnapshot,
  compareSnapshots,
  composeSnapshotEmail,
  delta,
  describeDelta,
  lastCompleteWeek,
  mondayOf,
  parseAnnualGoalCents,
  rowToSnapshot,
  snapshotToRow,
} from '@/lib/billing/weeklySnapshot'
import type { BillingItem, BillingPayment } from '@/lib/billing/types'
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_META } from '@/lib/email/categories'
import { SYSTEM_AUTOMATIONS } from '@/lib/automations/registry'

/**
 * The weekly financial snapshot. The firm's money was only ever read live on
 * the Billing page; nothing came to the attorney on its own and nothing
 * remembered last week. These pin down the week arithmetic, the figures, the
 * week-over-week comparison, the email, and the stored row.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

function item(overrides: Partial<BillingItem> & { id: string }): BillingItem {
  return {
    matterId: `matter-${overrides.id}`,
    kind: 'flat_fee',
    label: 'Flat fee',
    plan: null,
    amountBilled: 100_000,
    status: 'invoiced',
    invoicedAt: '2026-09-15T16:00:00.000Z',
    source: 'engagement',
    lastRemindedAt: null,
    createdAt: '2026-09-01T16:00:00.000Z',
    clientName: 'Client',
    clientEmail: null,
    matterNumber: null,
    practiceArea: 'EP',
    planType: 'joint_trust',
    legalPlan: null,
    ...overrides,
  }
}

function payment(overrides: Partial<BillingPayment> & { id: string; billingItemId: string; amount: number; receivedAt: string }): BillingPayment {
  return { method: 'check', note: null, ...overrides }
}

// The week of Monday Sep 28 to Sunday Oct 4, 2026, read on Monday Oct 5.
const window = lastCompleteWeek('2026-10-05')

describe('the week', () => {
  it('finds the Monday on or before a date', () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
    expect(mondayOf('2026-10-08')).toBe('2026-10-05')
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
  })

  it('is the last complete Monday-to-Sunday week before today', () => {
    expect(window).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-05', previousWeekStart: '2026-09-21', label: 'Sep 28 – Oct 4, 2026' })
    // Run late (Wednesday): still the week that ended Sunday.
    expect(lastCompleteWeek('2026-10-07').weekStart).toBe('2026-09-28')
    // Across a year boundary.
    expect(lastCompleteWeek('2027-01-04')).toMatchObject({ weekStart: '2026-12-28', weekEnd: '2027-01-04', label: 'Dec 28 – Jan 3, 2027' })
  })
})

describe('the figures', () => {
  const items = [
    // Invoiced before the week, paid in full during the week.
    item({ id: 'a', amountBilled: 300_000, status: 'paid', invoicedAt: '2026-09-10T16:00:00.000Z' }),
    // Invoiced during the week, half paid during the week, half still open and current.
    item({ id: 'b', amountBilled: 200_000, status: 'partial', invoicedAt: '2026-09-30T16:00:00.000Z' }),
    // Invoiced in June, unpaid: past due and over 60 days.
    item({ id: 'c', amountBilled: 150_000, status: 'invoiced', invoicedAt: '2026-06-01T16:00:00.000Z' }),
    // A cost entered during the week.
    item({ id: 'd', kind: 'cost', amountBilled: 12_500, status: 'to_invoice', invoicedAt: null, createdAt: '2026-10-01T16:00:00.000Z' }),
    // A client charge not yet invoiced.
    item({ id: 'e', amountBilled: 50_000, status: 'to_invoice', invoicedAt: null, createdAt: '2026-09-20T16:00:00.000Z' }),
    // A plan claim submitted during the week and unpaid, and one not yet submitted.
    item({ id: 'f', kind: 'plan_claim', plan: 'metlife', amountBilled: 90_000, status: 'claim_submitted', invoicedAt: '2026-09-29T16:00:00.000Z' }),
    item({ id: 'g', kind: 'plan_claim', plan: 'metlife', amountBilled: 60_000, status: 'to_invoice', invoicedAt: null }),
  ]
  const payments = [
    payment({ id: 'p1', billingItemId: 'a', amount: 300_000, receivedAt: '2026-09-29T15:00:00.000Z', paymentGroupId: 'g1' }),
    payment({ id: 'p2', billingItemId: 'b', amount: 100_000, receivedAt: '2026-10-02T15:00:00.000Z', paymentGroupId: 'g2' }),
    // The week before.
    payment({ id: 'p0', billingItemId: 'c', amount: 0, receivedAt: '2026-09-22T15:00:00.000Z' }),
    payment({ id: 'p3', billingItemId: 'a', amount: 0, receivedAt: '2026-09-23T15:00:00.000Z' }),
    // Earlier in the year, so year-to-date exceeds the week.
    payment({ id: 'p4', billingItemId: 'c', amount: 0, receivedAt: '2026-02-01T15:00:00.000Z' }),
  ]
  const snapshot = buildWeeklyFinancialSnapshot({ items, payments, window, annualGoalCents: 12_000_000 })

  it('counts what came in, what went out, and what was entered during the week only', () => {
    expect(snapshot.collectedCents).toBe(400_000)
    expect(snapshot.paymentCount).toBe(2)
    expect(snapshot.billedCents).toBe(290_000) // b invoiced + f submitted; costs are not "billed"
    expect(snapshot.billedCount).toBe(2)
    expect(snapshot.costsCents).toBe(12_500)
    expect(snapshot.previousWeekCollectedCents).toBe(0)
  })

  it('reads receivables as of the Monday after', () => {
    // Open: b 100,000 (current), c 150,000 (over 60 days), d 12,500, e 50,000, f 90,000, g 60,000
    expect(snapshot.outstandingCents).toBe(462_500)
    expect(snapshot.openCount).toBe(6)
    expect(snapshot.overdueCents).toBe(150_000)
    expect(snapshot.overdueCount).toBe(1)
    expect(snapshot.aging.days61Plus).toBe(150_000)
    expect(snapshot.aging.current + snapshot.aging.days31To60 + snapshot.aging.days61Plus).toBe(snapshot.outstandingCents)
    expect(snapshot.toInvoiceCents).toBe(62_500) // d + e, not the claim g
    expect(snapshot.toInvoiceCount).toBe(2)
    expect(snapshot.claimsOutstandingCents).toBe(90_000)
    expect(snapshot.claimsAwaitingCents).toBe(60_000)
    expect(snapshot.claimsAwaitingCount).toBe(1)
  })

  it('measures the year against the goal and the pace the goal implies', () => {
    expect(snapshot.ytdCollectedCents).toBe(400_000)
    expect(snapshot.goalCents).toBe(12_000_000)
    expect(snapshot.goalProgressPercent).toBe(3)
    // Oct 4 is day 277 of 365: the goal implies 12,000,000 × 277/365.
    expect(snapshot.paceCents).toBe(Math.round(12_000_000 * 277 / 365))
    expect(snapshot.paceDeltaCents).toBe(400_000 - snapshot.paceCents)
    expect(snapshot.paceDeltaCents).toBeLessThan(0)
  })

  it('survives an empty ledger and a zero goal', () => {
    const empty = buildWeeklyFinancialSnapshot({ items: [], payments: [], window, annualGoalCents: 0 })
    expect(empty.collectedCents).toBe(0)
    expect(empty.goalProgressPercent).toBe(0)
    expect(empty.paceCents).toBe(0)
    expect(Number.isNaN(empty.paceDeltaCents)).toBe(false)
  })
})

describe('week over week', () => {
  it('describes a change in plain words and knows which direction is good', () => {
    expect(delta(120, 100)).toEqual({ cents: 20, percent: 20 })
    expect(delta(80, 100)).toEqual({ cents: -20, percent: -20 })
    expect(delta(50, 0)).toEqual({ cents: 50, percent: null })
    expect(delta(50, null)).toEqual({ cents: 50, percent: null })
    expect(describeDelta(delta(120, 100))).toEqual({ text: 'up 20%', good: true })
    expect(describeDelta(delta(80, 100), { goodWhenUp: false })).toEqual({ text: 'down 20%', good: true })
    expect(describeDelta(delta(100, 100))).toEqual({ text: 'unchanged', good: null })
    expect(describeDelta(delta(0, null))).toEqual({ text: '', good: null })
  })

  it('falls back to the ledger\'s own prior-week figure when no row was stored', () => {
    const current = buildWeeklyFinancialSnapshot({
      items: [item({ id: 'a', status: 'paid', invoicedAt: '2026-09-01T16:00:00.000Z' })],
      payments: [
        payment({ id: 'p1', billingItemId: 'a', amount: 60_000, receivedAt: '2026-09-29T15:00:00.000Z' }),
        payment({ id: 'p2', billingItemId: 'a', amount: 40_000, receivedAt: '2026-09-22T15:00:00.000Z' }),
      ],
      window,
      annualGoalCents: 1_000_000,
    })
    const comparison = compareSnapshots(current, null)
    expect(comparison.collected).toEqual({ cents: 20_000, percent: 50 })
    expect(comparison.outstanding.percent).toBeNull()
  })
})

describe('the Monday email', () => {
  const snapshot = buildWeeklyFinancialSnapshot({
    items: [
      item({ id: 'a', amountBilled: 250_000, status: 'paid', invoicedAt: '2026-09-01T16:00:00.000Z' }),
      item({ id: 'c', amountBilled: 150_000, status: 'invoiced', invoicedAt: '2026-06-01T16:00:00.000Z' }),
    ],
    payments: [payment({ id: 'p1', billingItemId: 'a', amount: 250_000, receivedAt: '2026-09-30T15:00:00.000Z' })],
    window,
    annualGoalCents: 12_000_000,
  })
  const previous = { ...snapshot, collectedCents: 200_000, outstandingCents: 300_000, overdueCents: 150_000 }
  const email = composeSnapshotEmail({ snapshot, previous, window, firmName: 'Aubrey Law', billingUrl: 'https://app.example.com/admin/billing?tab=insights' })

  it('leads with the week, what came in, and what is outstanding', () => {
    expect(email.subject).toBe('Aubrey Law week of Sep 28: $2,500 collected (up 25%), $1,500 outstanding')
    expect(email.text).toContain('Week of Sep 28 – Oct 4, 2026')
    expect(email.text).toContain('Collected: $2,500 (1 payment, up 25% vs the week before)')
    expect(email.text).toContain('Past due: $1,500 (1 item, unchanged vs the week before)')
    expect(email.text).toContain('Aging: $0 current · $0 at 31–60 days · $1,500 over 60')
    expect(email.text).toContain('Collected this year: $2,500 (2% of the $120,000 goal)')
    expect(email.text).toContain('Behind by')
    expect(email.text).toContain('Open Billing: https://app.example.com/admin/billing?tab=insights')
    expect(email.html).toContain('<a href="https://app.example.com/admin/billing?tab=insights"')
    expect(email.html).toContain('Where things stand on Oct 5, 2026')
  })
})

describe('the stored row', () => {
  it('round-trips through typed columns and the metrics document', () => {
    const snapshot = buildWeeklyFinancialSnapshot({
      items: [item({ id: 'a', amountBilled: 250_000, status: 'paid', invoicedAt: '2026-09-01T16:00:00.000Z' })],
      payments: [payment({ id: 'p1', billingItemId: 'a', amount: 250_000, receivedAt: '2026-09-30T15:00:00.000Z' })],
      window,
      annualGoalCents: 12_000_000,
    })
    const row = snapshotToRow(snapshot)
    expect(row.week_start).toBe('2026-09-28')
    expect(row.collected_cents).toBe(250_000)
    expect(row.metrics).toBe(snapshot)
    const back = rowToSnapshot({ ...row, id: 'row-1', sent_at: null, email_status: null, created_at: '2026-10-05T12:10:00.000Z' })
    expect(back).toMatchObject({ ...snapshot, id: 'row-1', sentAt: null })
  })

  it('reads a row whose metrics are missing from the typed columns alone', () => {
    const back = rowToSnapshot({ id: 'r', week_start: '2026-09-28', week_end: '2026-10-05', collected_cents: 100, outstanding_cents: 50, goal_cents: 1_000, ytd_collected_cents: 250, metrics: null, created_at: 'x' })
    expect(back.collectedCents).toBe(100)
    expect(back.goalProgressPercent).toBe(25)
    expect(back.aging).toEqual({ current: 0, days31To60: 0, days61Plus: 0 })
  })

  it('checks the goal and explains what is wrong in a sentence', () => {
    expect(parseAnnualGoalCents(15_000_000)).toBe(15_000_000)
    expect(parseAnnualGoalCents('12,000,000')).toBe(12_000_000)
    expect(() => parseAnnualGoalCents(0)).toThrow('The annual goal must be a positive amount')
    expect(() => parseAnnualGoalCents('abc')).toThrow('positive amount')
  })
})

describe('the Monday run', () => {
  it('is a system automation with a matching deployment cron and an internal email category', () => {
    expect(SYSTEM_AUTOMATIONS.find(entry => entry.key === 'weekly-financial-snapshot')).toMatchObject({ path: '/api/cron/weekly-financial-snapshot', schedules: ['10 12 * * 1'] })
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    expect(vercel.crons).toContainEqual({ path: '/api/cron/weekly-financial-snapshot', schedule: '10 12 * * 1' })
    expect(EMAIL_CATEGORIES).toContain('weekly_financial_snapshot')
    expect(EMAIL_CATEGORY_META.weekly_financial_snapshot.recipient).toBe('internal')
  })

  it('stores one row per week and sends once, under the shared run control', () => {
    const route = read('app/api/cron/weekly-financial-snapshot/route.ts')
    expect(route).toContain("runSystemAutomation('weekly-financial-snapshot'")
    expect(route).toContain('CRON_SECRET')
    const server = read('lib/billing/weeklySnapshotServer.ts')
    expect(server).toContain(".upsert(snapshotToRow(snapshot), { onConflict: 'week_start' })")
    expect(server).toContain('input.force === true || !row.sent_at')
    expect(server).toContain("category: 'weekly_financial_snapshot'")
    expect(server).toContain('to: ADMIN_EMAIL')
    // The same loader as the Billing page, so the email and the page agree.
    expect(server).toContain('fetchBillingData({ userId: NO_USER')
  })

  it('ships the schema: one row per week, aggregates only, staff can read', () => {
    const migration = read('supabase/migrations/20270118090000_weekly_financial_snapshot.sql')
    expect(migration).toContain('create table if not exists public.billing_weekly_snapshots')
    expect(migration).toContain('week_start            date not null unique')
    expect(migration).toContain('grant select on table public.billing_weekly_snapshots to authenticated')
    expect(migration).toContain("'system:weekly-financial-snapshot'")
    expect(read('packages/db-types/src/supabase.generated.ts')).toContain('billing_weekly_snapshots: {')
  })

  it('shows on the Reports view and lets administrators set the goal', () => {
    expect(read('app/admin/billing/BillingClient.tsx')).toContain('<WeeklySnapshotCard />')
    const goalRoute = read('app/api/admin/settings/billing/route.ts')
    expect(goalRoute).toContain('requireAdministrator(req)')
    // The column the Billing page has read since the start, now with a place to change it.
    expect(read('lib/billing/weeklySnapshotServer.ts')).toContain("update({ billing_annual_goal_cents: cents })")
  })
})
