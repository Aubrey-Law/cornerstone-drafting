// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BillingSnapshot } from '@/lib/billing/types'

const matterOptions = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Chen, Marcus & Lily · 2026-EP-Chen-014' },
]

const twoMatterOptions = [
  ...matterOptions,
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', label: 'Nguyen, Peter & An · 2026-EP-Nguyen-003' },
]

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  refresh: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh }),
  useSearchParams: () => navigation.params,
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'access-token' }))
vi.mock('sonner', () => ({ toast }))

import BillingClient from '@/app/admin/billing/BillingClient'

const snapshot: BillingSnapshot = {
  selectedMonth: '2026-07',
  annualGoalCents: 12_000_000,
  revenue: {
    total: { current: 480_000, prior: 400_000, count: 1 },
    trust: { current: 480_000, prior: 400_000, count: 1 },
    will: { current: 0, prior: 0, count: 0 },
    probate: { current: 0, prior: 0, count: 0 },
    legal: { current: 0, prior: 0, count: 0 },
  },
  outstanding: { amount: 330_000, openCount: 1, overdueAmount: 330_000 },
  collectedMonth: { amount: 100_000, priorAmount: 50_000, deltaPercent: 100 },
  collectedYtd: { amount: 250_000, goal: 12_000_000, progressPercent: 2 },
  averageDaysToCollect: { all: 19, flatFee: 19, planClaim: null },
  aging: { current: 0, days31To60: 330_000, days61Plus: 0 },
  rows: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      matterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
      payments: [],
      collected: 150_000,
      balance: 330_000,
      ageDays: 59,
      overdue: true,
      paidAt: null,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      matterId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'flat_fee',
      label: 'Flat fee — Will plan',
      plan: null,
      amountBilled: 220_000,
      status: 'paid',
      invoicedAt: '2026-07-01T16:00:00.000Z',
      source: 'engagement',
      lastRemindedAt: null,
      createdAt: '2026-02-10T16:00:00.000Z',
      clientName: "O'Brien, Kathleen",
      clientEmail: 'obrien@example.com',
      matterNumber: '2026-EP-OBrien-009',
      practiceArea: 'EP',
      planType: 'will_plan',
      legalPlan: null,
      payments: [],
      collected: 220_000,
      balance: 0,
      ageDays: 0,
      overdue: false,
      paidAt: '2026-07-20T16:00:00.000Z',
    },
  ],
  openClaims: [],
  unpreparedClaims: [],
  nudges: [],
}

// Radix Select needs these in jsdom before its listbox will open.
if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

describe('billing workspace', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    navigation.params = new URLSearchParams()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:billing'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('defaults to open receivables and gives overdue display precedence', () => {
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} />)

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open.*1/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Chen, Marcus & Lily')).toBeTruthy()
    expect(screen.queryByText("O'Brien, Kathleen")).toBeNull()
    expect(screen.getAllByText('Overdue')).toHaveLength(2)
  })

  it('syncs the selected ledger filter into the URL', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} />)

    await user.click(screen.getByRole('button', { name: /Paid.*1/ }))

    expect(navigation.replace).toHaveBeenCalledWith('/admin/billing?filter=paid', { scroll: false })
  })

  it('opens an accessible payment dialog and blocks an overpayment', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} />)

    await user.click(screen.getByRole('button', { name: 'Log payment' }))
    expect(screen.getByRole('dialog', { name: 'Log payment' })).toBeTruthy()
    expect(screen.getByLabelText('Billing item').textContent).toContain('Chen, Marcus & Lily')

    const amount = screen.getByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, '4000')
    await user.click(screen.getByRole('button', { name: 'Save payment' }))

    expect(screen.getByRole('alert').textContent).toContain('cannot exceed the open balance')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('closes the payment dialog with Escape and restores focus to its opener', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} />)

    const opener = screen.getByRole('button', { name: 'Log payment' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Log payment' })).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Log payment' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('records a valid payment in cents and refreshes server truth', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ item: { id: snapshot.rows[0].id, status: 'partial' } }),
    )
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} />)

    await user.click(screen.getByRole('button', { name: 'Log payment' }))
    const amount = screen.getByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, '125.50')
    await user.click(screen.getByRole('button', { name: 'Save payment' }))

    expect(fetch).toHaveBeenCalledWith(
      `/api/admin/billing/items/${snapshot.rows[0].id}/payments`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          amount: 12_550,
          method: 'check',
          note: null,
        }),
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('$125.50 payment logged')
    expect(navigation.refresh).toHaveBeenCalled()
  })

  it('adds a charge to a chosen matter through the audited create route', async () => {
    const user = userEvent.setup()
    const post = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ item: {} }), { status: 201 }),
    )
    vi.stubGlobal('fetch', post)
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} />)

    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    // Unlike the matter tab, this surface must pick a matter.
    expect(within(dialog).getByLabelText('Matter')).toBeTruthy()

    await user.click(within(dialog).getByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'Cost' }))
    await user.type(within(dialog).getByLabelText('Description'), 'Deed recording fee')
    await user.type(within(dialog).getByLabelText('Amount'), '155')
    await user.click(within(dialog).getByRole('button', { name: 'Add charge' }))

    await waitFor(() => {
      const call = post.mock.calls.find(entry => entry[0] === '/api/admin/billing/items')
      expect(JSON.parse(call![1].body)).toEqual({
        matterId: matterOptions[0].id,
        kind: 'cost',
        label: 'Deed recording fee',
        amountBilled: 15_500,
        plan: null,
      })
    })
  })

  it('warns per matter, following the picker rather than the visible filter', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={twoMatterOptions} />)

    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')

    // Chen carries the flat fee in the fixture, so the default pick warns.
    expect(within(dialog).getByRole('status').textContent).toContain('already has a legal fee')

    await user.click(within(dialog).getByLabelText('Matter'))
    await user.click(await screen.findByRole('option', { name: /Nguyen/ }))
    expect(within(dialog).queryByRole('status')).toBeNull()
  })
})
