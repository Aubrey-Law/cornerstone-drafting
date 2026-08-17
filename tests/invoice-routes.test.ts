import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  fetchInvoices: vi.fn(),
  fetchInvoice: vi.fn(),
  fetchInvoiceableCharges: vi.fn(),
  renderAndAttachInvoice: vi.fn(),
  emailInvoice: vi.fn(),
  reloadInvoice: vi.fn(),
  logInvoiceActivity: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@/lib/queries/invoices', () => ({
  fetchInvoices: mocks.fetchInvoices,
  fetchInvoice: mocks.fetchInvoice,
  fetchInvoiceableCharges: mocks.fetchInvoiceableCharges,
}))
vi.mock('@/lib/invoices/issue', () => ({
  renderAndAttachInvoice: mocks.renderAndAttachInvoice,
  emailInvoice: mocks.emailInvoice,
  reloadInvoice: mocks.reloadInvoice,
  logInvoiceActivity: mocks.logInvoiceActivity,
}))

import { POST as createInvoice } from '@/app/api/admin/billing/invoices/route'
import { DELETE as discardInvoice, PATCH as updateInvoice } from '@/app/api/admin/billing/invoices/[id]/route'
import { POST as issueInvoice } from '@/app/api/admin/billing/invoices/[id]/issue/route'
import { POST as invoicePayment } from '@/app/api/admin/billing/invoices/[id]/payments/route'
import { POST as voidInvoice } from '@/app/api/admin/billing/invoices/[id]/void/route'

const INVOICE_ID = '33333333-3333-4333-8333-333333333333'
const MATTER_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const context = { params: Promise.resolve({ id: INVOICE_ID }) }

function post(body: unknown) {
  return new Request('http://app.test/api/admin/billing/invoices', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const draft = {
  matterId: MATTER_ID,
  itemIds: [ITEM_ID],
  issueDate: '2026-09-30',
  dueDate: '2026-10-30',
}

describe('invoice routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ err: null, userId: USER_ID, user: { id: USER_ID } })
    mocks.rpc.mockResolvedValue({ data: { id: INVOICE_ID, status: 'draft' }, error: null })
  })

  it('rejects an unauthenticated create before touching billing data', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })

    const response = await createInvoice(post(draft))

    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('forwards the authenticated actor and the charge ids to the RPC', async () => {
    const response = await createInvoice(post(draft))

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('create_invoice_draft', expect.objectContaining({
      p_matter_id: MATTER_ID,
      p_item_ids: [ITEM_ID],
      p_issue_date: '2026-09-30',
      p_due_date: '2026-10-30',
      p_actor_id: USER_ID,
    }))
  })

  it('refuses a due date that precedes the issue date', async () => {
    const response = await createInvoice(post({ ...draft, dueDate: '2026-09-01' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Due date cannot precede the issue date' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses an invoice with no charges', async () => {
    const response = await createInvoice(post({ ...draft, itemIds: [] }))

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses a malformed matter id', async () => {
    const response = await createInvoice(post({ ...draft, matterId: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('maps a plan-claim rejection onto a conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'A legal plan claim is billed to the carrier' },
    })

    const response = await createInvoice(post(draft))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'A legal plan claim is billed to the carrier',
    })
  })

  it('maps a missing actor role onto a forbidden', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Attorney or admin access required' },
    })

    expect((await createInvoice(post(draft))).status).toBe(403)
  })

  it('rejects a malformed invoice id on update', async () => {
    const response = await updateInvoice(post(draft), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    })

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('updates a draft through the actor-checked RPC, without moving its matter', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: INVOICE_ID }, error: null })

    // matterId is deliberately sent and deliberately ignored: the RPC has no
    // parameter for it, so an invoice cannot be moved by editing it.
    const response = await updateInvoice(post({ ...draft, notes: 'Revised' }), context)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('update_invoice_draft', {
      p_invoice_id: INVOICE_ID,
      p_item_ids: draft.itemIds,
      p_issue_date: draft.issueDate,
      p_due_date: draft.dueDate,
      p_notes: 'Revised',
      p_terms: null,
      p_bill_to_name: null,
      p_bill_to_email: null,
      p_payment_link: null,
      p_actor_id: USER_ID,
    })
  })

  it('maps an edit of an already-issued invoice onto a conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Only a draft invoice can be edited' },
    })

    const response = await updateInvoice(post(draft), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Only a draft invoice can be edited' })
  })

  it('refuses an edit that empties the invoice', async () => {
    const response = await updateInvoice(post({ ...draft, itemIds: [] }), context)

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('discards a draft through the actor-checked RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    const response = await discardInvoice(
      new Request('http://app.test', { method: 'DELETE' }),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('discard_invoice_draft', {
      p_invoice_id: INVOICE_ID,
      p_actor_id: USER_ID,
    })
  })

  it('rejects an over-balance payment with a conflict, not a 500', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22003', message: 'Payment exceeds invoice balance' },
    })

    const response = await invoicePayment(
      post({ amount: 500_000, method: 'check' }),
      context,
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Payment exceeds invoice balance' })
  })

  it('refuses a non-positive payment before reaching the database', async () => {
    const response = await invoicePayment(post({ amount: 0, method: 'check' }), context)

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('requires a reason to void', async () => {
    const response = await voidInvoice(post({ reason: '   ' }), context)

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('issues before rendering, so a render failure cannot roll back the number', async () => {
    const invoice = {
      id: INVOICE_ID,
      matterId: MATTER_ID,
      number: '2026-0004',
      status: 'issued',
      subtotalCents: 245_000,
      dueDate: '2026-10-30',
      billToEmail: null,
      clientEmail: null,
    }
    mocks.reloadInvoice.mockResolvedValue(invoice)
    mocks.renderAndAttachInvoice.mockRejectedValue(new Error('convert worker unreachable'))

    const response = await issueInvoice(post({ send: true }), context)

    expect(mocks.rpc).toHaveBeenCalledWith('issue_invoice', {
      p_invoice_id: INVOICE_ID,
      p_actor_id: USER_ID,
    })
    // 207: the invoice is real and numbered; only the document is missing.
    expect(response.status).toBe(207)
    expect((await response.json()).warning).toContain('2026-0004')
  })

  it('issues without sending when there is no address on file', async () => {
    mocks.reloadInvoice.mockResolvedValue({
      id: INVOICE_ID,
      matterId: MATTER_ID,
      number: '2026-0005',
      status: 'issued',
      subtotalCents: 100_000,
      dueDate: '2026-10-30',
      billToEmail: null,
      clientEmail: null,
    })
    mocks.renderAndAttachInvoice.mockResolvedValue({
      pdf: null, docx: { id: 'doc' }, renderData: {}, pdfUnavailableReason: null,
    })

    const response = await issueInvoice(post({ send: true }), context)

    expect(response.status).toBe(207)
    expect(mocks.emailInvoice).not.toHaveBeenCalled()
    expect((await response.json()).warning).toContain('no email address')
  })
})
