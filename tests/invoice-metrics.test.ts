import { describe, expect, it } from 'vitest'
import { buildBillingSnapshot, buildRows } from '@/lib/billing/metrics'
import type { BillingItem, BillingPayment } from '@/lib/billing/types'

const TODAY = '2026-07-30'
const NOW = new Date('2026-07-30T16:00:00.000Z')

function item(overrides: Partial<BillingItem> = {}): BillingItem {
  return {
    id: 'item-1',
    matterId: 'matter-1',
    kind: 'flat_fee',
    label: 'Flat fee — Trust package',
    plan: null,
    amountBilled: 200_000,
    status: 'invoiced',
    invoicedAt: '2026-07-01T16:00:00.000Z',
    source: 'manual',
    lastRemindedAt: null,
    createdAt: '2026-06-01T16:00:00.000Z',
    clientName: 'Chen, Marcus',
    clientEmail: 'chen@example.com',
    matterNumber: '2026-EP-Chen-014',
    practiceArea: 'EP',
    planType: 'joint_trust',
    legalPlan: null,
    ...overrides,
  }
}

function payment(overrides: Partial<BillingPayment> = {}): BillingPayment {
  return {
    id: 'pay-1',
    billingItemId: 'item-1',
    amount: 50_000,
    method: 'check',
    note: null,
    receivedAt: '2026-07-20T16:00:00.000Z',
    ...overrides,
  }
}

describe('overdue derivation with an invoice due date', () => {
  it('uses the invoice due date once the charge is on an invoice', () => {
    // Invoiced 29 days ago, so the legacy 30-day rule would say "not yet late",
    // but the invoice was due on the 15th.
    const [row] = buildRows([item({ invoiceDueOn: '2026-07-15' })], [], TODAY)
    expect(row.overdue).toBe(true)
  })

  it('is not overdue on the due date itself', () => {
    const [row] = buildRows([item({ invoiceDueOn: TODAY })], [], TODAY)
    expect(row.overdue).toBe(false)
  })

  it('respects a due date further out than thirty days', () => {
    // Net-60 terms: 29 days old, so the legacy rule agrees, but the point is
    // that the due date is what decides.
    const [row] = buildRows([item({ invoiceDueOn: '2026-08-30' })], [], TODAY)
    expect(row.overdue).toBe(false)
  })

  it('keeps the legacy thirty-day rule for a charge with no invoice', () => {
    const old = item({ invoicedAt: '2026-06-01T16:00:00.000Z' })
    const recent = item({ invoicedAt: '2026-07-20T16:00:00.000Z' })
    expect(buildRows([old], [], TODAY)[0].overdue).toBe(true)
    expect(buildRows([recent], [], TODAY)[0].overdue).toBe(false)
  })

  it('is never overdue once the balance is cleared', () => {
    const [row] = buildRows(
      [item({ invoiceDueOn: '2026-01-01' })],
      [payment({ amount: 200_000 })],
      TODAY,
    )
    expect(row.balance).toBe(0)
    expect(row.overdue).toBe(false)
  })

  it('leaves the per-charge balance arithmetic untouched', () => {
    const [row] = buildRows([item({ invoiceDueOn: '2026-07-15' })], [payment()], TODAY)
    expect(row.collected).toBe(50_000)
    expect(row.balance).toBe(150_000)
  })
})

describe('grouped payments on the recent activity card', () => {
  const snapshot = (payments: BillingPayment[], items: BillingItem[]) =>
    buildBillingSnapshot({
      items,
      payments,
      selectedMonth: '2026-07',
      annualGoalCents: 12_000_000,
      now: NOW,
      dismissedNudgeKeys: [],
      unpreparedClaims: [],
    })

  it('collapses one client payment split across three charges into one row', () => {
    const items = [
      item({ id: 'item-fee', amountBilled: 200_000 }),
      item({ id: 'item-cost-a', kind: 'cost', label: 'Recording fee', amountBilled: 30_000 }),
      item({ id: 'item-cost-b', kind: 'cost', label: 'Courier', amountBilled: 15_000 }),
    ]
    const group = 'group-1'
    const payments = [
      payment({ id: 'pay-a', billingItemId: 'item-fee', amount: 200_000, paymentGroupId: group, invoiceNumber: '2026-0004' }),
      payment({ id: 'pay-b', billingItemId: 'item-cost-a', amount: 30_000, paymentGroupId: group, invoiceNumber: '2026-0004' }),
      payment({ id: 'pay-c', billingItemId: 'item-cost-b', amount: 15_000, paymentGroupId: group, invoiceNumber: '2026-0004' }),
    ]

    const recent = snapshot(payments, items).recentPayments

    expect(recent).toHaveLength(1)
    expect(recent[0].amount).toBe(245_000)
    expect(recent[0].invoiceNumber).toBe('2026-0004')
    expect(recent[0].allocationCount).toBe(3)
  })

  it('still shows ungrouped payments individually', () => {
    const items = [item({ id: 'item-fee' }), item({ id: 'item-cost', kind: 'cost', label: 'Recording fee', amountBilled: 30_000 })]
    const payments = [
      payment({ id: 'pay-a', billingItemId: 'item-fee', amount: 50_000 }),
      payment({ id: 'pay-b', billingItemId: 'item-cost', amount: 30_000 }),
    ]

    const recent = snapshot(payments, items).recentPayments

    expect(recent).toHaveLength(2)
    expect(recent.every(row => row.allocationCount === 1)).toBe(true)
  })

  it('collapses before taking the top slice, so one split payment does not crowd the card', () => {
    // Eight slots. A three-way split plus eight singles must still leave eight
    // distinct payments on the card, not six singles and one split.
    const items = [
      item({ id: 'item-fee', amountBilled: 900_000 }),
      ...Array.from({ length: 8 }, (_, index) =>
        item({ id: `item-${index}`, kind: 'cost', label: `Cost ${index}`, amountBilled: 10_000 })),
    ]
    const payments = [
      ...['a', 'b', 'c'].map((suffix, index) => payment({
        id: `pay-split-${suffix}`,
        billingItemId: 'item-fee',
        amount: 10_000,
        paymentGroupId: 'group-split',
        // Newest, so the group would otherwise take three of the eight slots.
        receivedAt: `2026-07-2${5 + index}T16:00:00.000Z`,
      })),
      ...Array.from({ length: 8 }, (_, index) => payment({
        id: `pay-single-${index}`,
        billingItemId: `item-${index}`,
        amount: 10_000,
        receivedAt: `2026-07-1${index}T16:00:00.000Z`,
      })),
    ]

    const recent = snapshot(payments, items).recentPayments

    expect(recent).toHaveLength(8)
    expect(recent.filter(row => row.allocationCount === 3)).toHaveLength(1)
    expect(new Set(recent.map(row => row.id)).size).toBe(8)
  })
})
