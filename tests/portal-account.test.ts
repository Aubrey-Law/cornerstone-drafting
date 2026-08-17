import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/queryColumns', () => ({ MATTER_DOCUMENT_COLUMNS: '*' }))

import { fetchPortalAccount } from '@/lib/queries/portal'

const MATTER = 'matter-1'

/**
 * The invoices read chains .eq().not().neq().order(); the payments read chains
 * .in(). Both resolve to whatever this fixture is given.
 */
function db(invoices: unknown[], payments: unknown[] = [], invoiceError: unknown = null) {
  const captured: Record<string, unknown> = {}
  mocks.from.mockImplementation((table: string) => {
    if (table === 'invoices') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: (...args: unknown[]) => { captured.not = args; return chain },
        neq: (...args: unknown[]) => { captured.neq = args; return chain },
        order: () => Promise.resolve({ data: invoices, error: invoiceError }),
      }
      return chain
    }
    return { select: () => ({ in: () => Promise.resolve({ data: payments, error: null }) }) }
  })
  return captured
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    number: '2026-0001',
    issue_date: '2026-07-01',
    due_date: '2026-07-31',
    subtotal_cents: 200_000,
    payment_link: null,
    pdf_document_id: 'doc-1',
    docx_document_id: 'doc-1-docx',
    status: 'issued',
    ...overrides,
  }
}

describe('fetchPortalAccount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('never asks the database for a draft or a void', async () => {
    // Belt and braces alongside RLS: this read deliberately uses the admin
    // client, so the filter has to be explicit here too.
    const captured = db([])
    await fetchPortalAccount(MATTER, '2026-08-17')

    expect(captured.not).toEqual(['issued_at', 'is', null])
    expect(captured.neq).toEqual(['status', 'void'])
  })

  it('reports the balance and the soonest due date across open invoices', async () => {
    db(
      [
        invoice({ id: 'inv-1', due_date: '2026-09-30', subtotal_cents: 200_000 }),
        invoice({ id: 'inv-2', due_date: '2026-09-15', subtotal_cents: 50_000 }),
      ],
      [{ invoice_id: 'inv-1', amount: 50_000 }],
    )

    const account = await fetchPortalAccount(MATTER, '2026-08-17')

    expect(account.balanceCents).toBe(200_000)
    expect(account.nextDueDate).toBe('2026-09-15')
    expect(account.invoices[0].collectedCents).toBe(50_000)
    expect(account.invoices[0].balanceCents).toBe(150_000)
  })

  it('marks an invoice paid once its balance clears', async () => {
    db([invoice()], [{ invoice_id: 'inv-1', amount: 200_000 }])
    const account = await fetchPortalAccount(MATTER, '2026-08-17')

    expect(account.invoices[0].paid).toBe(true)
    expect(account.invoices[0].overdue).toBe(false)
    expect(account.balanceCents).toBe(0)
    expect(account.nextDueDate).toBeNull()
  })

  it('marks an unpaid invoice overdue only after its due date', async () => {
    db([invoice({ due_date: '2026-08-16' })])
    expect((await fetchPortalAccount(MATTER, '2026-08-17')).invoices[0].overdue).toBe(true)

    db([invoice({ due_date: '2026-08-17' })])
    expect((await fetchPortalAccount(MATTER, '2026-08-17')).invoices[0].overdue).toBe(false)
  })

  it('falls back to the Word document when no PDF was produced', async () => {
    db([invoice({ pdf_document_id: null })])
    expect((await fetchPortalAccount(MATTER, '2026-08-17')).invoices[0].documentId)
      .toBe('doc-1-docx')
  })

  it('returns an empty account rather than throwing when the read fails', async () => {
    db([], [], { message: 'boom' })
    expect(await fetchPortalAccount(MATTER, '2026-08-17'))
      .toEqual({ invoices: [], balanceCents: 0, nextDueDate: null })
  })
})
