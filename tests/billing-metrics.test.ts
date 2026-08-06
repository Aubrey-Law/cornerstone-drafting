import { describe, expect, it } from 'vitest'
import {
  billingCsv,
  billingStatusPresentation,
  buildBillingSnapshot,
  filterBillingRows,
} from '@/lib/billing/metrics'
import type { BillingItem, BillingPayment } from '@/lib/billing/types'

const NOW = new Date('2026-07-30T16:00:00.000Z')

const items: BillingItem[] = [
  {
    id: 'item-trust',
    matterId: 'matter-trust',
    kind: 'flat_fee',
    label: 'Flat fee — Joint trust package',
    plan: null,
    amountBilled: 480_000,
    status: 'partial',
    invoicedAt: '2026-06-01T16:00:00.000Z',
    source: 'engagement',
    lastRemindedAt: null,
    createdAt: '2026-01-10T16:00:00.000Z',
    clientName: 'Chen, Marcus & Lily',
    clientEmail: 'chen@example.com',
    matterNumber: '2026-EP-Chen-014',
    practiceArea: 'EP',
    planType: 'joint_trust',
    legalPlan: null,
  },
  {
    id: 'item-legal',
    matterId: 'matter-legal',
    kind: 'flat_fee',
    label: 'Flat fee — Legal plan',
    plan: null,
    amountBilled: 100_000,
    status: 'paid',
    invoicedAt: '2026-07-01T16:00:00.000Z',
    source: 'engagement',
    lastRemindedAt: null,
    createdAt: '2026-02-01T16:00:00.000Z',
    clientName: 'Rodriguez, Daniel',
    clientEmail: 'daniel@example.com',
    matterNumber: '2026-EP-Rodriguez-011',
    practiceArea: 'EP',
    planType: 'will_plan',
    legalPlan: 'MetLife',
  },
  {
    id: 'item-cost',
    matterId: 'matter-cost',
    kind: 'cost',
    label: 'Costs — deed recording',
    plan: null,
    amountBilled: 15_500,
    status: 'to_invoice',
    invoicedAt: null,
    source: 'manual',
    lastRemindedAt: null,
    createdAt: '2026-07-20T16:00:00.000Z',
    clientName: 'Kaplan, Susan',
    clientEmail: null,
    matterNumber: '2026-EP-Kaplan-016',
    practiceArea: 'EP',
    planType: 'will_plan',
    legalPlan: null,
  },
  {
    id: 'item-probate',
    matterId: 'matter-probate',
    kind: 'flat_fee',
    label: 'Flat fee — Probate',
    plan: null,
    amountBilled: 200_000,
    status: 'invoiced',
    invoicedAt: '2026-03-01T16:00:00.000Z',
    source: 'engagement',
    lastRemindedAt: '2026-07-10T16:00:00.000Z',
    createdAt: '2026-03-01T16:00:00.000Z',
    clientName: 'Walsh, Brian',
    clientEmail: 'walsh@example.com',
    matterNumber: '2026-PB-Walsh-003',
    practiceArea: 'Probate',
    planType: null,
    legalPlan: null,
  },
  {
    id: 'item-claim',
    matterId: 'matter-claim',
    kind: 'plan_claim',
    label: 'LegalEASE claim',
    plan: 'legalease',
    amountBilled: 90_000,
    status: 'paid',
    invoicedAt: '2026-05-01T16:00:00.000Z',
    source: 'workflow',
    lastRemindedAt: null,
    createdAt: '2026-05-01T16:00:00.000Z',
    clientName: 'DiSanto, Angela',
    clientEmail: 'disanto@example.com',
    matterNumber: '2026-EP-DiSanto-005',
    practiceArea: 'EP',
    planType: 'will_plan',
    legalPlan: 'LegalEASE',
  },
  {
    id: 'item-prior-will',
    matterId: 'matter-prior',
    kind: 'flat_fee',
    label: 'Flat fee — Will plan',
    plan: null,
    amountBilled: 300_000,
    status: 'paid',
    invoicedAt: '2025-06-01T16:00:00.000Z',
    source: 'engagement',
    lastRemindedAt: null,
    createdAt: '2025-06-01T16:00:00.000Z',
    clientName: 'Prior, Client',
    clientEmail: 'prior@example.com',
    matterNumber: '2025-EP-Prior-001',
    practiceArea: 'EP',
    planType: 'will_plan',
    legalPlan: null,
  },
]

const payments: BillingPayment[] = [
  {
    id: 'pay-trust-june',
    billingItemId: 'item-trust',
    amount: 50_000,
    method: 'ach',
    note: null,
    receivedAt: '2026-06-15T16:00:00.000Z',
  },
  {
    id: 'pay-trust-july',
    billingItemId: 'item-trust',
    amount: 100_000,
    method: 'check',
    note: null,
    receivedAt: '2026-07-10T16:00:00.000Z',
  },
  {
    id: 'pay-legal-a',
    billingItemId: 'item-legal',
    amount: 40_000,
    method: 'plan_eft',
    note: null,
    receivedAt: '2026-07-10T16:00:00.000Z',
  },
  {
    id: 'pay-legal-b',
    billingItemId: 'item-legal',
    amount: 60_000,
    method: 'plan_eft',
    note: 'Final EOB',
    receivedAt: '2026-07-20T16:00:00.000Z',
  },
  {
    id: 'pay-claim',
    billingItemId: 'item-claim',
    amount: 90_000,
    method: 'plan_eft',
    note: null,
    receivedAt: '2026-05-22T16:00:00.000Z',
  },
  {
    id: 'pay-prior',
    billingItemId: 'item-prior-will',
    amount: 300_000,
    method: 'check',
    note: null,
    receivedAt: '2025-06-20T16:00:00.000Z',
  },
]

describe('billing metrics', () => {
  it('derives balances, overdue flags, payment completion, and oldest-balance order', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(snapshot.rows.slice(0, 3).map(row => row.id)).toEqual([
      'item-probate',
      'item-trust',
      'item-cost',
    ])
    expect(snapshot.rows.find(row => row.id === 'item-trust')).toMatchObject({
      collected: 150_000,
      balance: 330_000,
      ageDays: 59,
      overdue: true,
    })
    expect(snapshot.rows.find(row => row.id === 'item-legal')?.paidAt).toBe(
      '2026-07-20T16:00:00.000Z',
    )
    expect(billingStatusPresentation(snapshot.rows[1])).toEqual({
      label: 'Overdue',
      tone: 'overdue',
    })
  })

  it('reconciles every open dollar into the three aging buckets', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(snapshot.outstanding).toEqual({
      amount: 545_500,
      openCount: 3,
      overdueAmount: 530_000,
    })
    expect(snapshot.aging).toEqual({
      current: 15_500,
      days31To60: 330_000,
      days61Plus: 200_000,
    })
    expect(Object.values(snapshot.aging).reduce((sum, amount) => sum + amount, 0)).toBe(
      snapshot.outstanding.amount,
    )
  })

  it('calculates selected month, prior month, YTD goal, and collection duration', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(snapshot.collectedMonth).toEqual({
      amount: 200_000,
      priorAmount: 50_000,
      deltaPercent: 300,
    })
    expect(snapshot.collectedYtd).toEqual({
      amount: 340_000,
      goal: 1_200_000,
      progressPercent: 28,
    })
    expect(snapshot.averageDaysToCollect).toEqual({
      all: 20,
      flatFee: 19,
      planClaim: 21,
    })
  })

  it('charts six months of collections anchored on the selected month', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(snapshot.collectionsTrend.points.map(point => point.month)).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ])
    expect(snapshot.collectionsTrend.points.map(point => point.label).at(-1)).toBe('Jul')
    // May carries the claim payment, June the prior-month figure, July the two EFTs.
    expect(snapshot.collectionsTrend.points.map(point => point.amount)).toEqual([
      0, 0, 0, 90_000, 50_000, 200_000,
    ])
    // 200,000 against a 50,000 June.
    expect(snapshot.collectionsTrend.deltaPercent).toBe(300)
  })

  it('separates costs billed and work still waiting to be invoiced', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    const costs = items.filter(item => item.kind === 'cost' && item.createdAt.startsWith('2026-07'))
    expect(snapshot.costsMonth.amount).toBe(
      costs.reduce((sum, item) => sum + item.amountBilled, 0),
    )
    expect(snapshot.pendingInvoices.count).toBe(
      snapshot.rows.filter(row => row.status === 'to_invoice').length,
    )
    expect(snapshot.pendingInvoices.overdueCount).toBe(
      snapshot.rows.filter(row => row.overdue).length,
    )
    expect(snapshot.pendingInvoices.overdueAmount).toBe(snapshot.outstanding.overdueAmount)
  })

  it('lists recent payments newest first with their client context', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    const dates = snapshot.recentPayments.map(payment => payment.receivedAt)
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates)
    expect(snapshot.recentPayments[0]).toMatchObject({
      id: 'pay-legal-b',
      matterId: 'matter-legal',
      clientName: 'Rodriguez, Daniel',
      method: 'plan_eft',
      amount: 60_000,
    })
  })

  it('groups engaged fees by the existing matter plan facts and compares prior year', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(snapshot.revenue).toEqual({
      total: { current: 780_000, prior: 300_000, count: 3 },
      trust: { current: 480_000, prior: 0, count: 1 },
      will: { current: 0, prior: 300_000, count: 0 },
      probate: { current: 200_000, prior: 0, count: 1 },
      legal: { current: 100_000, prior: 0, count: 1 },
    })
  })

  it('filters paid rows to the selected month while leaving open rows month-independent', () => {
    const snapshot = buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(filterBillingRows(snapshot.rows, 'paid', '', '2026-07').map(row => row.id)).toEqual([
      'item-legal',
    ])
    expect(filterBillingRows(snapshot.rows, 'open', 'chen', '2026-07').map(row => row.id)).toEqual([
      'item-trust',
    ])
    expect(filterBillingRows(snapshot.rows, 'overdue', '', '2026-07').map(row => row.id)).toEqual([
      'item-probate',
      'item-trust',
    ])
  })

  it('exports literal ledger values with CSV escaping', () => {
    const snapshot = buildBillingSnapshot({
      items: [items[0]],
      payments: payments.slice(0, 2),
      selectedMonth: '2026-07',
      annualGoalCents: 1_200_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

    expect(billingCsv(snapshot.rows)).toBe(
      'Client,Matter,Item,Billed,Collected,Balance,Status,Invoice date,Age days\n'
      + '"Chen, Marcus & Lily",2026-EP-Chen-014,Flat fee — Joint trust package,4800.00,1500.00,3300.00,Overdue,2026-06-01,59',
    )
  })
})
