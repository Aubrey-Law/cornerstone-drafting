// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

async function chooseRecordAction(
  user: ReturnType<typeof userEvent.setup>,
  name: 'Log payment' | 'Add charge',
) {
  await user.click(screen.getByRole('button', { name: 'Record' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

async function chooseRowAction(
  user: ReturnType<typeof userEvent.setup>,
  rowName: string,
  name: 'Edit charge' | 'Delete charge',
) {
  await user.click(screen.getByRole('button', { name: `More actions for ${rowName}` }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

async function chooseSelectionAction(
  user: ReturnType<typeof userEvent.setup>,
  name: 'Delete selected',
) {
  await user.click(screen.getByRole('button', { name: 'More selected actions' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

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
  collectionsTrend: {
    points: [
      { month: '2026-02', label: 'Feb', amount: 0 },
      { month: '2026-03', label: 'Mar', amount: 25_000 },
      { month: '2026-04', label: 'Apr', amount: 40_000 },
      { month: '2026-05', label: 'May', amount: 35_000 },
      { month: '2026-06', label: 'Jun', amount: 50_000 },
      { month: '2026-07', label: 'Jul', amount: 100_000 },
    ],
    deltaPercent: 100,
  },
  costsMonth: { amount: 15_500, priorAmount: 20_000, deltaPercent: -23 },
  pendingInvoices: { amount: 0, count: 0, overdueCount: 1, overdueAmount: 330_000 },
  recentPayments: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      billingItemId: '11111111-1111-4111-8111-111111111111',
      matterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientName: 'Chen, Marcus & Lily',
      matterNumber: '2026-EP-Chen-014',
      label: 'Flat fee — Joint trust package',
      kind: 'flat_fee',
      method: 'check',
      amount: 150_000,
      receivedAt: '2026-07-18T16:00:00.000Z',
      note: 'Check 1024 — deposit',
    },
  ],
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
  planBilling: [],
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
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

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
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open.*1/ }).getAttribute('aria-pressed')).toBe('true')
    // Scoped to the ledger: the client also appears in the recent-payments rail.
    const ledger = within(screen.getByRole('table'))
    expect(ledger.getByText('Chen, Marcus & Lily')).toBeTruthy()
    expect(ledger.queryByText("O'Brien, Kathleen")).toBeNull()
    expect(screen.getAllByText('Overdue')).toHaveLength(2)
  })

  it('syncs the selected ledger filter into the URL', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await user.click(screen.getByRole('button', { name: /Paid.*1/ }))

    expect(navigation.replace).toHaveBeenCalledWith('/admin/billing?filter=paid&month=2026-07', { scroll: false })
  })

  it('opens an accessible payment dialog and blocks an overpayment', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await chooseRecordAction(user, 'Log payment')
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
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    const opener = screen.getByRole('button', { name: 'Record' })
    await chooseRecordAction(user, 'Log payment')
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
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await chooseRecordAction(user, 'Log payment')
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
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await chooseRecordAction(user, 'Add charge')
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
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={twoMatterOptions} invoices={[]} />)

    await chooseRecordAction(user, 'Add charge')
    const dialog = await screen.findByRole('dialog')

    // Chen carries the flat fee in the fixture, so the default pick warns.
    expect(within(dialog).getByRole('status').textContent).toContain('already has a legal fee')

    await user.click(within(dialog).getByLabelText('Matter'))
    await user.click(await screen.findByRole('option', { name: /Nguyen/ }))
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  // ── Phase 3: page shape, filtering and batch billing ──────────────────

  it('opens on billing work and keeps reporting cards in Reports', () => {
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    expect(screen.getByRole('link', { name: 'Billing work' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('columnheader', { name: 'Client / matter' })).toBeTruthy()
    expect(screen.queryByText('Collected this month')).toBeNull()
    expect(screen.queryByText('Collection goal')).toBeNull()
  })

  it('reduces the page header to one primary action and two menus', () => {
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    expect(screen.getByRole('link', { name: 'New invoice' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More billing actions' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add charge' })).toBeNull()
  })

  it('turns the work summary into direct filters without loading reporting cards', () => {
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    expect(screen.getByRole('link', { name: /Ready to invoice.*1/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open balances.*1/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Past due.*1/ })).toBeTruthy()
  })

  it('debounces ledger search before replacing the URL', () => {
    vi.useFakeTimers()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search billing clients' }), {
      target: { value: 'Chen' },
    })
    expect(navigation.replace).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining('search=Chen'),
      { scroll: false },
    )
    vi.useRealTimers()
  })

  it('shows a compact ledger without duplicate accounting columns', () => {
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    const ledger = within(screen.getByRole('table'))
    expect(ledger.getByRole('columnheader', { name: 'Charge / invoice' })).toBeTruthy()
    expect(ledger.getByRole('columnheader', { name: 'Balance' })).toBeTruthy()
    expect(ledger.queryByRole('columnheader', { name: 'Billed' })).toBeNull()
    expect(ledger.queryByRole('columnheader', { name: 'Collected' })).toBeNull()
    expect(ledger.queryByRole('columnheader', { name: 'Age' })).toBeNull()
  })

  it('offers a To invoice filter for work that still needs billing', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await user.click(screen.getByRole('button', { name: /To invoice/ }))
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        expect.stringContaining('filter=to_invoice'),
        expect.anything(),
      ))
  })

  it('subtotals a matter that carries more than one charge', () => {
    const twoOnOneMatter = {
      ...snapshot,
      rows: [
        snapshot.rows[0],
        {
          ...snapshot.rows[0],
          id: '44444444-4444-4444-8444-444444444444',
          kind: 'cost' as const,
          label: 'Deed recording fee',
          amountBilled: 45_000,
          collected: 0,
          balance: 45_000,
        },
      ],
    }
    render(<BillingClient initialSnapshot={twoOnOneMatter} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    // $3,300 + $450 read as one client owing one amount.
    expect(screen.getByText('Chen, Marcus & Lily · 2 charges')).toBeTruthy()
    expect(screen.getByLabelText('Select all 2 charges for Chen, Marcus & Lily')).toBeTruthy()
    expect(screen.getByText('$3,750')).toBeTruthy()
  })

  it('previews the invoices a multi-matter selection will create before making any', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(
      Response.json({ created: [{ invoiceId: 'inv-1' }, { invoiceId: 'inv-2' }], skipped: [] }),
    )
    vi.stubGlobal('fetch', request)
    // Both rows uninvoiced and owing, on two different matters.
    const billable = {
      ...snapshot,
      rows: [
        { ...snapshot.rows[0], invoiceId: null },
        { ...snapshot.rows[1], balance: 220_000, collected: 0, invoiceId: null },
      ],
    }
    render(<BillingClient initialSnapshot={billable} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await user.click(screen.getByLabelText('Select all billing items in view'))
    await user.click(await screen.findByRole('button', { name: 'Create 2 invoices' }))

    const dialog = await screen.findByRole('dialog', { name: 'Create 2 invoices' })
    expect(within(dialog).getByText('Chen, Marcus & Lily')).toBeTruthy()
    expect(within(dialog).getByText("O'Brien, Kathleen")).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Create 2 drafts' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/api/admin/billing/invoices/batch',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(JSON.parse(request.mock.calls[0][1].body).itemIds).toHaveLength(2)
  })

  // The reminder used to open a blank `mailto:`. It now sends a branded email
  // with the invoice attached and records the send.
  it('sends a real templated reminder for an overdue invoice', async () => {
    navigation.params = new URLSearchParams('tab=insights')
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(Response.json({ sent: true }))
    vi.stubGlobal('fetch', request)
    const assign = vi.fn()
    vi.stubGlobal('location', { assign, href: 'http://app.test/admin/billing' })

    render(
      <BillingClient
        initialSnapshot={{
          ...snapshot,
          nudges: [{
            key: 'reminder:invoice:inv-1',
            kind: 'reminder',
            clientName: 'Chen, Marcus & Lily',
            description: 'Invoice 2026-0004, 20 days past due',
            itemId: snapshot.rows[0].id,
            matterId: snapshot.rows[0].matterId,
            clientEmail: 'chen@example.com',
            legalPlan: null,
            invoiceId: 'inv-1',
            invoiceNumber: '2026-0004',
          }],
        }}
        loadError={null}
        weekStart="2026-07-27"
        matterOptions={matterOptions} invoices={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remind' }))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/api/admin/billing/invoices/inv-1/reminder',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    // 20 days past due escalates past "friendly" but not to "final". Found by
    // URL: the Reports view's cards read their own data on mount, so the
    // reminder is not necessarily the first request.
    const reminder = request.mock.calls.find(entry => entry[0] === '/api/admin/billing/invoices/inv-1/reminder')
    expect(JSON.parse(reminder![1].body)).toEqual({
      tone: 'firm',
      attachInvoice: true,
    })
    // Nothing may navigate the window to a mail client.
    expect(assign).not.toHaveBeenCalled()
  })

  it('deletes one ledger charge through the REST delete', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(Response.json({ deleted: 1, items: [] }))
    vi.stubGlobal('fetch', request)
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await chooseRowAction(user, 'Flat fee — Joint trust package for Chen, Marcus & Lily', 'Delete charge')
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 charge?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete 1 charge' }))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        `/api/admin/billing/items/${snapshot.rows[0].id}`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        }),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('Charge deleted')
    expect(navigation.refresh).toHaveBeenCalled()
  })

  it('bulk deletes only the rows the current filter shows', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(Response.json({ ok: true, deleted: 2, requested: 2 }))
    vi.stubGlobal('fetch', request)
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    // The default Open filter hides the paid O'Brien row, so selecting every
    // visible row must not reach it.
    await user.click(screen.getByRole('checkbox', { name: 'Select all billing items in view' }))
    expect(screen.getByText('1 selected')).toBeTruthy()

    await chooseSelectionAction(user, 'Delete selected')
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 charge?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete 1 charge' }))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        `/api/admin/billing/items/${snapshot.rows[0].id}`,
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
    expect(request.mock.calls.some(call => call[0] === '/api/admin/billing/items/bulk-delete')).toBe(false)
  })

  it('sends a multi-row selection to the bulk delete route in one call', async () => {
    navigation.params = new URLSearchParams('filter=all')
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(Response.json({ ok: true, deleted: 2, requested: 2 }))
    vi.stubGlobal('fetch', request)
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select all billing items in view' }))
    await chooseSelectionAction(user, 'Delete selected')
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 charges?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 charges' }))

    await waitFor(() => {
      const call = request.mock.calls.find(entry => entry[0] === '/api/admin/billing/items/bulk-delete')
      expect(JSON.parse(call![1].body)).toEqual({
        ids: [snapshot.rows[0].id, snapshot.rows[1].id],
      })
    })
    expect(toast.success).toHaveBeenCalledWith('2 charges deleted')
  })

  it('keeps a failed deletion visible instead of reporting success', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(
      Response.json({ error: 'Attorney or admin access required' }, { status: 403 }),
    )
    vi.stubGlobal('fetch', request)
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    await chooseRowAction(user, 'Flat fee — Joint trust package for Chen, Marcus & Lily', 'Delete charge')
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 charge?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete 1 charge' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Attorney or admin access required')
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete 1 charge?' })).toBeTruthy()
  })
  it('edits a ledger charge through the PATCH route, on its own matter', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue(Response.json({ item: {} }))
    vi.stubGlobal('fetch', request)
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={twoMatterOptions} invoices={[]} />)

    await chooseRowAction(user, 'Flat fee — Joint trust package for Chen, Marcus & Lily', 'Edit charge')
    const dialog = await screen.findByRole('dialog', { name: 'Edit charge' })
    // The matter picker gives way: an edit stays where its payments are.
    expect(within(dialog).queryByLabelText('Matter')).toBeNull()
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('4800.00')

    const label = within(dialog).getByLabelText('Description')
    await user.clear(label)
    await user.type(label, 'Flat fee — Joint trust package (revised)')
    await user.click(within(dialog).getByRole('button', { name: 'Save charge' }))

    await waitFor(() => {
      const call = request.mock.calls.find(entry => entry[1]?.method === 'PATCH')
      expect(call![0]).toBe(`/api/admin/billing/items/${snapshot.rows[0].id}`)
      expect(JSON.parse(call![1].body)).toEqual({
        kind: 'flat_fee',
        label: 'Flat fee — Joint trust package (revised)',
        amountBilled: 480_000,
        plan: null,
      })
    })
    expect(navigation.refresh).toHaveBeenCalled()
  })

  it('restores the matter picker for the next added charge', async () => {
    const user = userEvent.setup()
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={twoMatterOptions} invoices={[]} />)

    await chooseRowAction(user, 'Flat fee — Joint trust package for Chen, Marcus & Lily', 'Edit charge')
    await user.click(within(await screen.findByRole('dialog', { name: 'Edit charge' }))
      .getByRole('button', { name: 'Cancel' }))

    await chooseRecordAction(user, 'Add charge')
    const dialog = await screen.findByRole('dialog', { name: 'Add charge' })
    expect(within(dialog).getByLabelText('Matter')).toBeTruthy()
  })
  it('shows the note a payment was logged with in the recent payments rail', () => {
    navigation.params = new URLSearchParams('tab=insights')
    render(<BillingClient initialSnapshot={snapshot} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    const rail = screen.getByText('Recent payments').closest('[data-slot="card"]') as HTMLElement
    expect(within(rail).getByText('Check 1024 — deposit')).toBeTruthy()
  })

  it('falls back to the charge the payment paid when no note was written', () => {
    navigation.params = new URLSearchParams('tab=insights')
    const noNote = {
      ...snapshot,
      recentPayments: [{ ...snapshot.recentPayments[0], note: null }],
    }
    render(<BillingClient initialSnapshot={noNote} loadError={null} weekStart="2026-07-27" matterOptions={matterOptions} invoices={[]} />)

    const rail = screen.getByText('Recent payments').closest('[data-slot="card"]') as HTMLElement
    expect(within(rail).getByText('Flat fee — Joint trust package')).toBeTruthy()
  })
})
