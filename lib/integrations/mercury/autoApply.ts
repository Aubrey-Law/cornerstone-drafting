/**
 * Which matched deposits may be recorded as payments, and how far the dial may
 * take each one.
 *
 * Pure, like the matcher it sits on: the daily run (autoApplyServer.ts) reads
 * Mercury and the ledger, this decides, and the dial records.
 *
 * Two tiers, and only two:
 *
 * - **Exact.** The deposit's amount equals one open invoice's balance and the
 *   sender's memo cites that invoice's number and no other. Nothing is
 *   inferred: the client said which invoice, and the money says the same. The
 *   dial may record these up to Act and report.
 * - **Proposed.** The matcher found one clear winner on amount (and usually
 *   name), but the memo does not say so. A strong guess is still a guess, so
 *   these always wait on Today, whatever the dial says.
 *
 * Anything else (a near-tie with no memo, an unmatched deposit, two deposits
 * reaching for one invoice) stays on the Billing card for a person to decide.
 */

import { mercuryReference, type DepositProposal, type MatchCandidate, type OpenInvoice } from './reconcile'

export type DepositPlanTier = 'exact' | 'proposed'

export type PaymentMethod = 'check' | 'ach'

export interface DepositPaymentPlan {
  tier: DepositPlanTier
  /** `mercury:<transaction id>`: the payment's external reference and the proposal's idempotency key. */
  reference: string
  transactionId: string
  invoiceId: string
  invoiceNumber: string | null
  matterId: string | null
  clientName: string | null
  amountCents: number
  postedAt: string
  payer: string | null
  memo: string | null
  method: PaymentMethod
  /** Why this deposit and this invoice, in words for the Today card. */
  basis: string
}

export type DepositSkipReason = 'not_a_candidate' | 'no_clear_match' | 'memo_disagrees' | 'contended'

export interface DepositPlanResult {
  plans: DepositPaymentPlan[]
  skipped: Array<{ transactionId: string; reason: DepositSkipReason }>
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The open invoice numbers a deposit's memo or bank description cites, as
 * whole tokens: "INV 2026-0012" cites 2026-0012; "2026-00123" does not.
 */
export function citedInvoiceNumbers(text: string | null | undefined, numbers: readonly string[]): string[] {
  if (!text) return []
  const cited = new Set<string>()
  for (const number of numbers) {
    if (!number) continue
    const pattern = new RegExp(`(^|[^0-9A-Za-z])${escapeRegExp(number)}($|[^0-9A-Za-z])`, 'i')
    if (pattern.test(text)) cited.add(number)
  }
  return [...cited]
}

/** Mercury names a paper check deposit; everything else that lands here is an electronic transfer. */
export function paymentMethodForDeposit(kind: string): PaymentMethod {
  return /check/i.test(kind) ? 'check' : 'ach'
}

function amountExact(candidate: MatchCandidate): boolean {
  return candidate.reasons.includes('amount_equals_balance') && !candidate.reasons.includes('posted_before_issue')
}

function basisFor(tier: DepositPlanTier, candidate: MatchCandidate): string {
  if (tier === 'exact') return `Amount equals the balance of invoice ${candidate.number ?? ''} and the memo names it`.replace(/\s+/g, ' ')
  if (candidate.reasons.includes('name_strong')) return 'Amount equals the balance and the payer’s name matches the client'
  if (candidate.reasons.includes('name_partial') || candidate.reasons.includes('name_surname')) return 'Amount equals the balance and the payer’s name partly matches the client'
  return 'Amount equals the balance of the only invoice it could be'
}

export function planDepositPayments(input: {
  proposals: readonly DepositProposal[]
  invoices: readonly OpenInvoice[]
}): DepositPlanResult {
  const numbers = input.invoices.map(invoice => invoice.number).filter((number): number is string => Boolean(number))
  const plans: DepositPaymentPlan[] = []
  const skipped: DepositPlanResult['skipped'] = []

  for (const proposal of input.proposals) {
    const { deposit } = proposal
    if (proposal.status !== 'proposed' && proposal.status !== 'ambiguous') {
      if (proposal.status === 'unmatched') skipped.push({ transactionId: deposit.transactionId, reason: 'no_clear_match' })
      continue
    }

    const cited = citedInvoiceNumbers(`${deposit.memo ?? ''} ${deposit.bankDescription ?? ''}`, numbers)
    const exactAmount = proposal.candidates.filter(amountExact)
    let tier: DepositPlanTier | null = null
    let chosen: MatchCandidate | undefined

    if (cited.length === 1) {
      chosen = exactAmount.find(candidate => candidate.number === cited[0])
      if (chosen) tier = 'exact'
      else {
        // The client named an invoice the money does not settle. A person decides.
        skipped.push({ transactionId: deposit.transactionId, reason: 'memo_disagrees' })
        continue
      }
    } else if (cited.length === 0 && proposal.status === 'proposed') {
      const best = proposal.candidates[0]
      if (best && amountExact(best)) {
        chosen = best
        tier = 'proposed'
      }
    } else if (cited.length > 1) {
      skipped.push({ transactionId: deposit.transactionId, reason: 'memo_disagrees' })
      continue
    }

    if (!tier || !chosen) {
      skipped.push({ transactionId: deposit.transactionId, reason: 'no_clear_match' })
      continue
    }

    plans.push({
      tier,
      reference: mercuryReference(deposit.transactionId),
      transactionId: deposit.transactionId,
      invoiceId: chosen.invoiceId,
      invoiceNumber: chosen.number,
      matterId: chosen.matterId,
      clientName: chosen.clientName,
      amountCents: deposit.amountCents,
      postedAt: deposit.postedAt,
      payer: deposit.counterpartyName,
      memo: deposit.memo ?? null,
      method: paymentMethodForDeposit(deposit.kind),
      basis: basisFor(tier, chosen),
    })
  }

  // Two deposits reaching for one invoice: neither is recorded on its own.
  const claims = new Map<string, number>()
  for (const plan of plans) claims.set(plan.invoiceId, (claims.get(plan.invoiceId) ?? 0) + 1)
  const kept: DepositPaymentPlan[] = []
  for (const plan of plans) {
    if ((claims.get(plan.invoiceId) ?? 0) > 1) skipped.push({ transactionId: plan.transactionId, reason: 'contended' })
    else kept.push(plan)
  }
  return { plans: kept, skipped }
}

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatCents(cents: number): string {
  return MONEY.format(cents / 100)
}

/** The Today card's one line. */
export function depositPlanSummary(plan: Pick<DepositPaymentPlan, 'amountCents' | 'invoiceNumber' | 'clientName'>): string {
  const invoice = plan.invoiceNumber ? `invoice ${plan.invoiceNumber}` : 'an invoice'
  return `Record ${formatCents(plan.amountCents)} from Mercury against ${invoice}${plan.clientName ? ` (${plan.clientName})` : ''}`
}

// ---------------------------------------------------------------------------
// The dial action's input
// ---------------------------------------------------------------------------

export type DepositPaymentInput = {
  invoiceId: string
  transactionId: string
  /** Always `mercury:<transactionId>`. */
  externalReference: string
  amountCents: number
  method: PaymentMethod
  receivedAt: string | null
  note: string
  tier: DepositPlanTier
  basis: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates `billing.payment.record`. Only a Mercury deposit can be recorded
 * through the dial: the reference must name the same transaction, so a
 * proposal can never post money the bank does not show.
 */
export function parseDepositPaymentInput(value: unknown): DepositPaymentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A payment must be an object')
  const input = value as Record<string, unknown>
  const invoiceId = typeof input.invoiceId === 'string' ? input.invoiceId.trim() : ''
  if (!UUID_RE.test(invoiceId)) throw new Error('A valid invoice is required')
  const transactionId = typeof input.transactionId === 'string' ? input.transactionId.trim() : ''
  if (!transactionId || transactionId.length > 100) throw new Error('A Mercury transaction is required')
  const externalReference = mercuryReference(transactionId)
  if (input.externalReference !== undefined && input.externalReference !== externalReference) {
    throw new Error('The reference must name the same Mercury transaction')
  }
  const amountCents = input.amountCents
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amountCents must be a positive whole number of cents')
  const method: PaymentMethod = input.method === 'check' ? 'check' : 'ach'
  let receivedAt: string | null = null
  if (typeof input.receivedAt === 'string' && input.receivedAt.trim()) {
    const parsed = new Date(input.receivedAt)
    if (Number.isNaN(parsed.getTime())) throw new Error('receivedAt must be a date and time')
    receivedAt = parsed.toISOString()
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : ''
  const tier: DepositPlanTier = input.tier === 'exact' ? 'exact' : 'proposed'
  const basis = typeof input.basis === 'string' ? input.basis.trim().slice(0, 300) : ''
  return { invoiceId, transactionId, externalReference, amountCents, method, receivedAt, note: note || 'Mercury deposit', tier, basis }
}
