import { describe, expect, it } from 'vitest'
import { buildBillingSnapshot } from '@/lib/billing/metrics'
import type { BillingItem, BillingNudge } from '@/lib/billing/types'

const NOW = new Date('2026-07-30T16:00:00.000Z')

function item(overrides: Partial<BillingItem> = {}): BillingItem {
  return {
    id: 'item-1',
    matterId: 'matter-1',
    kind: 'flat_fee',
    label: 'Flat fee — Trust package',
    plan: null,
    amountBilled: 200_000,
    status: 'to_invoice',
    invoicedAt: null,
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

function nudges(items: BillingItem[], dismissed: string[] = []): BillingNudge[] {
  return buildBillingSnapshot({
    items,
    payments: [],
    selectedMonth: '2026-07',
    annualGoalCents: 12_000_000,
    now: NOW,
    dismissedNudgeKeys: dismissed,
    unpreparedClaims: [],
  }).nudges
}

describe('billing follow-up nudges', () => {
  it('asks you to bill a matter, not each charge on it', () => {
    // Three unbilled charges on one matter are one job — the composer groups
    // them onto a single invoice.
    const result = nudges([
      item({ id: 'a', amountBilled: 200_000 }),
      item({ id: 'b', kind: 'cost', label: 'Recording fee', amountBilled: 45_000 }),
      item({ id: 'c', kind: 'cost', label: 'Courier', amountBilled: 15_000 }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('bill')
    expect(result[0].key).toBe('bill:matter-1')
    expect(result[0].description).toBe('Bill 3 charges ($2,600)')
  })

  it('names the single charge when a matter has only one', () => {
    const [nudge] = nudges([item()])
    expect(nudge.kind).toBe('bill')
    expect(nudge.description).toBe('Bill flat fee — trust package')
  })

  it('raises one bill nudge per matter', () => {
    const result = nudges([
      item({ id: 'a', matterId: 'matter-1' }),
      item({ id: 'b', matterId: 'matter-2', clientName: 'Rodriguez, Daniel' }),
    ])
    expect(result.map(n => n.key).sort()).toEqual(['bill:matter-1', 'bill:matter-2'])
  })

  it('sends a plan claim to the carrier rather than a client invoice', () => {
    const [nudge] = nudges([
      item({ kind: 'plan_claim', plan: 'metlife', label: 'MetLife claim' }),
    ])
    expect(nudge.kind).toBe('claim_submit')
    expect(nudge.key).toBe('claim-submit:item-1')
    expect(nudge.description).toContain('carrier')
  })

  it('raises a reminder keyed on the invoice, carrying its id', () => {
    const [nudge] = nudges([
      item({
        status: 'invoiced',
        invoicedAt: '2026-06-01T16:00:00.000Z',
        invoiceId: 'inv-1',
        invoiceNumber: '2026-0004',
        invoiceDueOn: '2026-06-30',
      }),
    ])
    expect(nudge.kind).toBe('reminder')
    expect(nudge.key).toBe('reminder:invoice:inv-1')
    expect(nudge.invoiceId).toBe('inv-1')
    expect(nudge.description).toBe('Invoice 2026-0004, 59 days past due')
  })

  it('reminds once per invoice, not once per charge on it', () => {
    const shared = {
      status: 'invoiced' as const,
      invoicedAt: '2026-06-01T16:00:00.000Z',
      invoiceId: 'inv-1',
      invoiceNumber: '2026-0004',
      invoiceDueOn: '2026-06-30',
    }
    const result = nudges([
      item({ id: 'a', ...shared }),
      item({ id: 'b', kind: 'cost', label: 'Recording fee', amountBilled: 45_000, ...shared }),
    ])
    expect(result.filter(n => n.kind === 'reminder')).toHaveLength(1)
  })

  it('offers to bill an overdue charge that never made it onto an invoice', () => {
    // A reminder here would have no invoice to attach, so the dead-end is
    // replaced by the action that actually helps.
    const [nudge] = nudges([
      item({ status: 'invoiced', invoicedAt: '2026-05-01T16:00:00.000Z' }),
    ])
    expect(nudge.kind).toBe('bill')
  })

  it('stays quiet for a week after a reminder goes out', () => {
    const result = nudges([
      item({
        status: 'invoiced',
        invoicedAt: '2026-06-01T16:00:00.000Z',
        invoiceId: 'inv-1',
        invoiceDueOn: '2026-06-30',
        lastRemindedAt: '2026-07-28T16:00:00.000Z',
      }),
    ])
    expect(result.filter(n => n.kind === 'reminder')).toHaveLength(0)
  })

  it('honours a dismissal for the week', () => {
    expect(nudges([item()], ['bill:matter-1'])).toHaveLength(0)
    expect(nudges(
      [item({ kind: 'plan_claim', plan: 'metlife', label: 'MetLife claim' })],
      ['claim-submit:item-1'],
    )).toHaveLength(0)
  })

  it('says nothing about a paid invoice', () => {
    expect(nudges([
      item({ status: 'paid', invoicedAt: '2026-06-01T16:00:00.000Z', invoiceId: 'inv-1' }),
    ])).toHaveLength(0)
  })
})
