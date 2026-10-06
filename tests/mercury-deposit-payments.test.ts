import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMercuryTransaction: vi.fn(),
  loadInvoiceBalances: vi.fn(),
  reloadInvoice: vi.fn(),
  logInvoiceActivity: vi.fn(),
}))

vi.mock('@/lib/integrations/mercury/client', () => ({ getMercuryTransaction: mocks.getMercuryTransaction, listMercuryTransactions: vi.fn() }))
vi.mock('@/lib/queries/invoiceBalances', () => ({ loadInvoiceBalances: mocks.loadInvoiceBalances }))
vi.mock('@/lib/invoices/issue', () => ({ reloadInvoice: mocks.reloadInvoice, logInvoiceActivity: mocks.logInvoiceActivity }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/integrations/mercury/config', () => ({
  getMercuryConfig: () => ({ token: 't', baseUrl: 'https://api.mercury.com/api/v1', incomeAccountIds: ['acct-income'] }),
  getMercuryConfigStatus: () => ({ tokenConfigured: true, baseUrlValid: true, incomeAccountsConfigured: true, sandbox: false }),
}))

import {
  citedInvoiceNumbers,
  depositPlanSummary,
  parseDepositPaymentInput,
  paymentMethodForDeposit,
  planDepositPayments,
  type DepositPaymentInput,
} from '@/lib/integrations/mercury/autoApply'
import { recordDepositPayment } from '@/lib/integrations/mercury/autoApplyServer'
import { proposeDepositMatches, type MercuryDeposit, type OpenInvoice } from '@/lib/integrations/mercury/reconcile'
import { toDeposit } from '@/lib/integrations/mercury/normalize'
import { mercuryTransactionSchema } from '@/lib/integrations/mercury/types'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG } from '@/lib/actions/autonomy'
import { SYSTEM_AUTOMATIONS } from '@/lib/automations/registry'

/**
 * Mercury deposits recorded as payments. The matcher only ever proposed; this
 * decides which proposals may be recorded and how far the dial may take them.
 * The line it must hold: only a deposit whose amount equals the balance AND
 * whose memo names the invoice is "exact"; everything else waits for a person.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const ACCOUNT = 'acct-income'
const INV_A = '00000000-0000-4000-8000-00000000000a'
const INV_B = '00000000-0000-4000-8000-00000000000b'
const MATTER = '00000000-0000-4000-8000-0000000000aa'

function invoice(overrides: Partial<OpenInvoice> = {}): OpenInvoice {
  return {
    invoiceId: INV_A,
    number: '2026-0012',
    matterId: MATTER,
    billToName: 'Lara Coakley',
    clientName: 'Lara Coakley',
    issueDate: '2026-09-01',
    subtotalCents: 250_000,
    balanceCents: 250_000,
    ...overrides,
  }
}

function deposit(overrides: Partial<MercuryDeposit> = {}): MercuryDeposit {
  return {
    transactionId: 'tx-1',
    accountId: ACCOUNT,
    amountCents: 250_000,
    postedAt: '2026-09-10T15:00:00Z',
    counterpartyName: 'Lara Coakley',
    bankDescription: null,
    kind: 'externalTransfer',
    status: 'sent',
    memo: null,
    ...overrides,
  }
}

function plan(deposits: MercuryDeposit[], invoices: OpenInvoice[]) {
  const proposals = proposeDepositMatches({ deposits, invoices, incomeAccountIds: [ACCOUNT], appliedReferences: new Set() })
  return planDepositPayments({ proposals, invoices })
}

describe('citedInvoiceNumbers', () => {
  it('finds whole invoice numbers only', () => {
    expect(citedInvoiceNumbers('INV 2026-0012 thanks', ['2026-0012', '2026-0001'])).toEqual(['2026-0012'])
    expect(citedInvoiceNumbers('Invoice #2026-0012.', ['2026-0012'])).toEqual(['2026-0012'])
    expect(citedInvoiceNumbers('ref 2026-00123', ['2026-0012'])).toEqual([])
    expect(citedInvoiceNumbers(null, ['2026-0012'])).toEqual([])
  })
})

describe('planDepositPayments', () => {
  it('is exact when the amount equals the balance and the memo names the invoice', () => {
    const { plans } = plan([deposit({ memo: 'Invoice 2026-0012' })], [invoice()])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ tier: 'exact', invoiceId: INV_A, reference: 'mercury:tx-1', method: 'ach', amountCents: 250_000 })
  })

  it('lets the memo settle a tie between two invoices for the same amount', () => {
    const invoices = [invoice(), invoice({ invoiceId: INV_B, number: '2026-0013', billToName: 'Sam Ortiz', clientName: 'Sam Ortiz' })]
    const anonymous = { counterpartyName: 'ACH CREDIT' }
    // Without a memo it is a tie the matcher will not decide.
    expect(plan([deposit(anonymous)], invoices).plans).toEqual([])
    const { plans } = plan([deposit({ ...anonymous, memo: 'for 2026-0013' })], invoices)
    expect(plans).toEqual([expect.objectContaining({ tier: 'exact', invoiceId: INV_B })])
  })

  it('is only a proposal when the memo is silent, however strong the name', () => {
    const { plans } = plan([deposit()], [invoice()])
    expect(plans).toEqual([expect.objectContaining({ tier: 'proposed', invoiceId: INV_A })])
    expect(plans[0].basis).toMatch(/name matches/)
  })

  it('refuses when the memo names an invoice the amount does not settle', () => {
    const invoices = [invoice(), invoice({ invoiceId: INV_B, number: '2026-0013', balanceCents: 90_000, subtotalCents: 90_000 })]
    const result = plan([deposit({ memo: '2026-0013' })], invoices)
    expect(result.plans).toEqual([])
    expect(result.skipped).toEqual([{ transactionId: 'tx-1', reason: 'memo_disagrees' }])
  })

  it('refuses a memo naming two invoices', () => {
    const invoices = [invoice(), invoice({ invoiceId: INV_B, number: '2026-0013' })]
    expect(plan([deposit({ memo: '2026-0012 and 2026-0013' })], invoices).skipped[0].reason).toBe('memo_disagrees')
  })

  it('never records two deposits against one invoice', () => {
    const result = plan([deposit({ memo: '2026-0012' }), deposit({ transactionId: 'tx-2', memo: '2026-0012' })], [invoice()])
    expect(result.plans).toEqual([])
    expect(result.skipped.map(item => item.reason)).toEqual(['contended', 'contended'])
  })

  it('is never exact for a deposit posted well before the invoice was issued', () => {
    const { plans } = plan([deposit({ memo: '2026-0012', postedAt: '2026-08-01T12:00:00Z' })], [invoice()])
    expect(plans.every(item => item.tier !== 'exact')).toBe(true)
  })

  it('leaves pending, unmatched and house deposits alone', () => {
    const deposits = [
      deposit({ transactionId: 'p', status: 'pending', memo: '2026-0012' }),
      deposit({ transactionId: 'u', amountCents: 1_234, memo: null, counterpartyName: 'Someone Else' }),
      deposit({ transactionId: 'h', counterpartyName: 'Mercury Savings', memo: '2026-0012' }),
    ]
    expect(plan(deposits, [invoice()]).plans).toEqual([])
  })

  it('maps check deposits and writes the Today line', () => {
    expect(paymentMethodForDeposit('checkDeposit')).toBe('check')
    expect(paymentMethodForDeposit('incomingDomesticWire')).toBe('ach')
    expect(depositPlanSummary({ amountCents: 250_000, invoiceNumber: '2026-0012', clientName: 'Lara Coakley' }))
      .toBe('Record $2,500.00 from Mercury against invoice 2026-0012 (Lara Coakley)')
  })
})

describe('the memo reaches the matcher', () => {
  it('keeps the external memo and note from Mercury', () => {
    const transaction = mercuryTransactionSchema.parse({
      id: 'tx-9', accountId: ACCOUNT, amount: '2500.00', status: 'sent', kind: 'externalTransfer',
      externalMemo: ' INV 2026-0012 ', note: 'paid by son',
    })
    expect(toDeposit(transaction).memo).toBe('INV 2026-0012 paid by son')
    expect(toDeposit(mercuryTransactionSchema.parse({ id: 'x', accountId: ACCOUNT, amount: 1, status: 'sent', kind: 'k' })).memo).toBeNull()
  })
})

describe('parseDepositPaymentInput', () => {
  const valid = { invoiceId: INV_A, transactionId: 'tx-1', amountCents: 250_000, method: 'ach', receivedAt: '2026-09-10T15:00:00Z', tier: 'exact' }

  it('accepts a payment and derives the reference from the transaction', () => {
    expect(parseDepositPaymentInput(valid)).toMatchObject({ externalReference: 'mercury:tx-1', receivedAt: '2026-09-10T15:00:00.000Z', note: 'Mercury deposit', tier: 'exact' })
  })

  it('refuses anything that would post money the bank does not show', () => {
    expect(() => parseDepositPaymentInput({ ...valid, invoiceId: 'nope' })).toThrow(/invoice/)
    expect(() => parseDepositPaymentInput({ ...valid, transactionId: '' })).toThrow(/Mercury/)
    expect(() => parseDepositPaymentInput({ ...valid, externalReference: 'mercury:other' })).toThrow(/same Mercury/)
    expect(() => parseDepositPaymentInput({ ...valid, amountCents: 0 })).toThrow(/amountCents/)
    expect(() => parseDepositPaymentInput({ ...valid, amountCents: 12.5 })).toThrow(/amountCents/)
  })
})

describe('recordDepositPayment', () => {
  const input: DepositPaymentInput = parseDepositPaymentInput({ invoiceId: INV_A, transactionId: 'tx-1', amountCents: 250_000, method: 'ach', tier: 'exact' })

  function admin(options: { recorded?: boolean; status?: string; rpcError?: { code: string; message: string } | null } = {}) {
    const rpc = vi.fn(async () => ({ error: options.rpcError ?? null }))
    return {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'billing_payments') {
          return { select: () => ({ eq: () => ({ limit: async () => ({ data: options.recorded ? [{ id: 'p' }] : [], error: null }) }) }) }
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: INV_A, number: '2026-0012', status: options.status ?? 'issued', matter_id: MATTER, subtotal_cents: 250_000, kind: 'invoice' }, error: null }) }) }),
        }
      }),
    }
  }

  function settled(overrides: Record<string, unknown> = {}) {
    return { id: 'tx-1', accountId: ACCOUNT, amountCents: 250_000, status: 'sent', kind: 'externalTransfer', counterpartyName: 'Lara Coakley', ...overrides }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMercuryTransaction.mockResolvedValue(settled())
    mocks.loadInvoiceBalances.mockResolvedValue(new Map([[INV_A, 250_000]]))
    mocks.reloadInvoice.mockResolvedValue({ id: INV_A, number: '2026-0012', status: 'paid', matterId: MATTER, subtotalCents: 250_000 })
  })

  it('records through the payment RPC with the Mercury reference and logs the paid invoice', async () => {
    const db = admin()
    const result = await recordDepositPayment(db as never, input, 'actor-1')
    expect(db.rpc).toHaveBeenCalledWith('record_invoice_payment', expect.objectContaining({
      p_invoice_id: INV_A, p_amount: 250_000, p_method: 'ach', p_actor_id: 'actor-1', p_external_reference: 'mercury:tx-1',
    }))
    expect(mocks.logInvoiceActivity).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'invoice_paid' }))
    expect(result).toMatchObject({ invoiceStatus: 'paid', reused: false })
  })

  it('does nothing for a deposit already recorded', async () => {
    const db = admin({ recorded: true })
    expect(await recordDepositPayment(db as never, input, 'actor-1')).toMatchObject({ reused: true })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(mocks.getMercuryTransaction).not.toHaveBeenCalled()
  })

  it('refuses a deposit Mercury now shows differently, reversed, pending or in another account', async () => {
    mocks.getMercuryTransaction.mockResolvedValueOnce(settled({ amountCents: 200_000 }))
    await expect(recordDepositPayment(admin() as never, input, 'actor-1')).rejects.toThrow(/Mercury now shows \$2,000/)
    mocks.getMercuryTransaction.mockResolvedValueOnce(settled({ status: 'Reversed' }))
    await expect(recordDepositPayment(admin() as never, input, 'actor-1')).rejects.toThrow(/did not settle/)
    mocks.getMercuryTransaction.mockResolvedValueOnce(settled({ status: 'pending' }))
    await expect(recordDepositPayment(admin() as never, input, 'actor-1')).rejects.toThrow(/pending/)
    mocks.getMercuryTransaction.mockResolvedValueOnce(settled({ accountId: 'acct-opex' }))
    await expect(recordDepositPayment(admin() as never, input, 'actor-1')).rejects.toThrow(/income account/)
  })

  it('refuses an invoice that is no longer open or owes less', async () => {
    await expect(recordDepositPayment(admin({ status: 'paid' }) as never, input, 'actor-1')).rejects.toThrow(/not open/)
    mocks.loadInvoiceBalances.mockResolvedValueOnce(new Map([[INV_A, 100_000]]))
    await expect(recordDepositPayment(admin() as never, input, 'actor-1')).rejects.toThrow(/more than the invoice/)
  })

  it('treats the unique-reference collision as already recorded', async () => {
    const db = admin({ rpcError: { code: '23505', message: 'duplicate key' } })
    expect(await recordDepositPayment(db as never, input, 'actor-1')).toMatchObject({ reused: true })
  })
})

describe('wiring', () => {
  it('the dial action is an internal write in the billing group', () => {
    expect(getActionDefinition('billing.payment.record')?.risk).toBe('internal_write')
    expect(ACTION_CATALOG['billing.payment.record']).toMatchObject({ group: 'billing' })
  })

  it('the run caps exact matches at Act and report and everything else at Propose', () => {
    const server = read('lib/integrations/mercury/autoApplyServer.ts')
    expect(server).toContain("autonomyCeiling: plan.tier === 'exact' ? 'act_report' : 'propose'")
    expect(server).toContain('idempotencyKey: plan.reference')
    expect(server).toContain('applyAutonomy: true')
    expect(server).toContain('if (!isMercuryConfigured()) return result')
  })

  it('the migration guards the reference and registers the automation', () => {
    const sql = read('supabase/migrations/20270120090000_mercury_deposit_payments.sql')
    expect(sql).toContain('on public.billing_payments (external_reference, billing_item_id)')
    expect(sql).toContain("where external_reference like 'mercury:%'")
    expect(sql).toContain("'system:mercury-deposits'")
  })

  it('the cron runs under the automation center', () => {
    expect(SYSTEM_AUTOMATIONS.find(entry => entry.key === 'mercury-deposits')).toMatchObject({ path: '/api/cron/mercury-deposits', schedules: ['35 11 * * *'] })
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    expect(vercel.crons).toContainEqual({ path: '/api/cron/mercury-deposits', schedule: '35 11 * * *' })
    const route = read('app/api/cron/mercury-deposits/route.ts')
    expect(route).toContain("runSystemAutomation('mercury-deposits'")
    expect(route).toContain('resolveUnattendedActor()')
  })
})
