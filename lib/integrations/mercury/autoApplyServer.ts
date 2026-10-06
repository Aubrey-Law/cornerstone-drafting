import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadInvoiceBalances } from '@/lib/queries/invoiceBalances'
import { logInvoiceActivity, reloadInvoice } from '@/lib/invoices/issue'
import { getMercuryTransaction } from './client'
import { getMercuryConfig } from './config'
import { isMercuryConfigured, loadMercuryDepositMatching } from './deposits'
import { toDeposit } from './normalize'
import { classifyDeposit } from './reconcile'
import { depositPlanSummary, formatCents, planDepositPayments, type DepositPaymentInput } from './autoApply'

/**
 * Mercury deposits recorded as invoice payments: the half that touches records.
 *
 * The daily run reads the last fortnight of deposits, plans them
 * (autoApply.ts), and offers each plan through the delegation dial as
 * `billing.payment.record`. Recording re-reads the deposit from Mercury and
 * the invoice from the ledger first, so a deposit that reversed, or an invoice
 * someone paid by hand in between, is refused rather than posted twice.
 */

type Admin = ReturnType<typeof getAdminClient>

export const PAYMENT_RECORD_ACTION_KEY = 'billing.payment.record'

const OPEN_STATUSES = new Set(['issued', 'partial'])

const REFUSAL_WORDS: Record<string, string> = {
  not_a_credit: 'is not money in',
  wrong_account: 'did not land in the income account',
  internal_transfer: 'is a transfer between the firm’s own accounts',
  card_activity: 'is card activity',
  house_credit: 'is a Mercury credit, not a client payment',
  not_settled: 'did not settle',
  pending_settlement: 'is still pending and can reverse',
}

export interface InvoiceForPayment {
  id: string
  number: string | null
  status: string
  matterId: string
  balanceCents: number
}

export async function loadInvoiceForPayment(admin: Admin, invoiceId: string): Promise<InvoiceForPayment> {
  const { data, error } = await admin.from('invoices')
    .select('id, number, status, matter_id, subtotal_cents, kind')
    .eq('id', invoiceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Invoice not found')
  const row = data as { id: string; number: string | null; status: string; matter_id: string; subtotal_cents: number; kind: string }
  const balances = await loadInvoiceBalances(admin, [{ id: row.id, subtotal_cents: row.subtotal_cents, kind: row.kind }])
  return { id: row.id, number: row.number, status: row.status, matterId: row.matter_id, balanceCents: balances.get(row.id) ?? 0 }
}

async function referenceAlreadyRecorded(admin: Admin, reference: string): Promise<boolean> {
  const { data, error } = await admin.from('billing_payments').select('id').eq('external_reference', reference).limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export interface RecordedDepositPayment {
  invoiceId: string
  invoiceNumber: string | null
  invoiceStatus: string
  amountCents: number
  reference: string
  reused: boolean
}

/**
 * Records one Mercury deposit against one invoice, after checking that the
 * deposit is still there and settled for the same amount, that nothing has
 * recorded it already, and that the invoice is still open for at least that
 * much.
 */
export async function recordDepositPayment(admin: Admin, input: DepositPaymentInput, actorId: string): Promise<RecordedDepositPayment> {
  if (await referenceAlreadyRecorded(admin, input.externalReference)) {
    const invoice = await loadInvoiceForPayment(admin, input.invoiceId)
    return { invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceStatus: invoice.status, amountCents: input.amountCents, reference: input.externalReference, reused: true }
  }

  const transaction = await getMercuryTransaction(input.transactionId)
  if (transaction.amountCents !== input.amountCents) {
    throw new Error(`Mercury now shows ${formatCents(transaction.amountCents)} for this deposit, not ${formatCents(input.amountCents)}`)
  }
  // The same filter the matcher applied, now on the authoritative copy: a
  // deposit that reversed or moved since the proposal is refused, not posted.
  const classified = classifyDeposit(
    { ...toDeposit(transaction), status: transaction.status.toLowerCase() },
    { incomeAccountIds: getMercuryConfig().incomeAccountIds, appliedReferences: new Set() },
  )
  if (classified.kind === 'ignored') {
    throw new Error(`Mercury now shows that this deposit ${REFUSAL_WORDS[classified.reason] ?? 'cannot be recorded'}, so it is not recorded`)
  }

  const invoice = await loadInvoiceForPayment(admin, input.invoiceId)
  if (!OPEN_STATUSES.has(invoice.status)) throw new Error(`Invoice ${invoice.number ?? ''} is ${invoice.status}, not open`.replace(/\s+/g, ' '))
  if (input.amountCents > invoice.balanceCents) {
    throw new Error(`The deposit (${formatCents(input.amountCents)}) is more than the invoice's balance (${formatCents(invoice.balanceCents)})`)
  }

  const { error } = await admin.rpc('record_invoice_payment', {
    p_invoice_id: input.invoiceId,
    p_amount: input.amountCents,
    p_method: input.method,
    p_note: input.note,
    p_received_at: input.receivedAt,
    p_actor_id: actorId,
    p_external_reference: input.externalReference,
    p_processor_fee_cents: 0,
  })
  if (error) {
    // The unique index on the reference: another run recorded it first.
    if (error.code === '23505') {
      return { invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceStatus: invoice.status, amountCents: input.amountCents, reference: input.externalReference, reused: true }
    }
    throw new Error(error.message)
  }

  const after = await reloadInvoice(input.invoiceId)
  if (after.status === 'paid') {
    await logInvoiceActivity({
      matterId: after.matterId,
      eventType: 'invoice_paid',
      title: `Invoice ${after.number} paid in full`,
      detail: `${formatCents(after.subtotalCents)} · Mercury deposit`,
      actorId,
      metadata: { invoice_id: after.id, number: after.number, external_reference: input.externalReference },
    })
  }
  return { invoiceId: after.id, invoiceNumber: after.number, invoiceStatus: after.status, amountCents: input.amountCents, reference: input.externalReference, reused: false }
}

export interface DepositRunResult {
  configured: boolean
  scanned: number
  exact: number
  proposedTier: number
  skipped: number
  recorded: number
  proposed: number
  observed: number
  duplicates: number
  failed: number
}

/**
 * The daily run. Exact plans may be recorded up to Act and report; every other
 * plan waits on Today whatever the dial says. Keyed to the Mercury transaction,
 * so a deposit is offered once however many times the run sees it.
 */
export async function prepareMercuryDepositMatching(input: { actorId: string | null; days?: number }): Promise<DepositRunResult> {
  const result: DepositRunResult = { configured: false, scanned: 0, exact: 0, proposedTier: 0, skipped: 0, recorded: 0, proposed: 0, observed: 0, duplicates: 0, failed: 0 }
  if (!isMercuryConfigured()) return result
  result.configured = true

  const { view, invoices } = await loadMercuryDepositMatching({ days: input.days ?? 14 })
  const { plans, skipped } = planDepositPayments({ proposals: view.proposals, invoices })
  result.scanned = view.summary.scanned
  result.skipped = skipped.length
  result.exact = plans.filter(plan => plan.tier === 'exact').length
  result.proposedTier = plans.length - result.exact
  if (plans.length === 0 || !input.actorId) return result

  const { createActionProposal } = await import('@/lib/actions/server')
  for (const plan of plans) {
    const payload: DepositPaymentInput = {
      invoiceId: plan.invoiceId,
      transactionId: plan.transactionId,
      externalReference: plan.reference,
      amountCents: plan.amountCents,
      method: plan.method,
      receivedAt: plan.postedAt || null,
      note: [`Mercury deposit${plan.payer ? ` from ${plan.payer}` : ''}`, plan.memo ? `memo: ${plan.memo}` : null].filter(Boolean).join('; ').slice(0, 500),
      tier: plan.tier,
      basis: plan.basis,
    }
    try {
      const created = await createActionProposal({
        actionKey: PAYMENT_RECORD_ACTION_KEY,
        displaySummary: depositPlanSummary(plan),
        referencePayload: { ...payload },
        recordType: plan.matterId ? 'matter' : 'firm',
        recordId: plan.matterId ?? undefined,
        source: 'automation',
        idempotencyKey: plan.reference,
        applyAutonomy: true,
        autonomyCeiling: plan.tier === 'exact' ? 'act_report' : 'propose',
      }, { id: input.actorId })
      if (created.duplicate) result.duplicates += 1
      else if (created.autonomy === 'observe') result.observed += 1
      else if (created.execution) { if (created.execution.status === 'succeeded') result.recorded += 1; else result.failed += 1 }
      else result.proposed += 1
    } catch (error) {
      console.error('[mercury deposits] payment proposal failed', { reference: plan.reference, cause: error instanceof Error ? error.message : String(error) })
      result.failed += 1
    }
  }
  return result
}
