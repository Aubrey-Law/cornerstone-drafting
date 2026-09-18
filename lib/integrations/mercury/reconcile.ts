/**
 * Matching bank deposits to open invoices.
 *
 * Pure by design: no network, no database, no clock, no randomness. The same
 * input always produces the same output, which is what makes a money-adjacent
 * heuristic reviewable and safe to retune.
 *
 * It proposes and never decides. Mercury carries no invoice linkage on a
 * transaction, so every match here is an inference from amount, name and date —
 * and a confident wrong inference posts money against the wrong client.
 */

export type MercuryDeposit = {
  transactionId: string
  accountId: string
  /** Signed integer cents; positive is money in. */
  amountCents: number
  postedAt: string
  counterpartyName: string | null
  bankDescription: string | null
  kind: string
  status: string
}

export type OpenInvoice = {
  invoiceId: string
  number: string | null
  matterId: string | null
  billToName: string | null
  clientName: string | null
  issueDate: string | null
  subtotalCents: number
  balanceCents: number
}

export type DepositIgnoreReason =
  | 'not_a_credit' | 'wrong_account' | 'internal_transfer' | 'card_activity'
  | 'house_credit' | 'not_settled' | 'pending_settlement'

export type MatchConfidence = 'exact' | 'probable' | 'possible'

export type MatchReason =
  | 'amount_equals_balance' | 'amount_equals_subtotal'
  | 'name_strong' | 'name_partial' | 'name_surname'
  | 'within_date_window' | 'posted_before_issue' | 'only_open_invoice'

export type MatchCandidate = {
  invoiceId: string
  number: string | null
  matterId: string | null
  clientName: string | null
  balanceCents: number
  confidence: MatchConfidence
  score: number
  reasons: MatchReason[]
}

export type DepositStatus = 'proposed' | 'ambiguous' | 'unmatched' | 'already_applied' | 'ignored'

export type DepositProposal = {
  deposit: MercuryDeposit
  status: DepositStatus
  ignoreReason: DepositIgnoreReason | null
  candidates: MatchCandidate[]
}

/**
 * Counterparties that are the firm's own money moving around.
 *
 * The live account is organised Profit-First, so transfers between the firm's
 * six accounts show up as ordinary credits, as does Mercury's own cashback.
 * Without this, "amount > 0" would classify the bank's housekeeping as client
 * payments.
 */
export const HOUSE_COUNTERPARTY_PATTERNS: readonly RegExp[] = [
  /^mercury\b/i,
  /\bio cashback\b/i,
  /\bmercury (checking|savings|treasury|vault|credit)\b/i,
  /\binterest (payment|paid)\b/i,
]

const UNSETTLED_STATUSES = new Set(['cancelled', 'failed', 'reversed', 'blocked'])

const SCORE_FLOOR = 25
const TIE_MARGIN = 15
const DEFAULT_DATE_WINDOW_DAYS = 45

const NAME_NOISE = new Set(['the', 'trust', 'revocable', 'living', 'family', 'llc', 'inc', 'estate', 'of', 'and'])

export function mercuryReference(transactionId: string): string {
  return `mercury:${transactionId}`
}

/** Lowercase, strip accents and punctuation, drop entity noise words. */
export function normalizePayerName(value: string | null): string[] {
  if (!value) return []
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(token => token.length > 1 && !NAME_NOISE.has(token))
}

/** Dice coefficient over token sets — order-insensitive, which payer names are. */
function nameSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  const shared = new Set(left.filter(token => rightSet.has(token))).size
  return (2 * shared) / (new Set(left).size + new Set(right).size)
}

function daysBetween(fromKey: string, toKey: string): number | null {
  const from = Date.parse(`${fromKey}T00:00:00Z`)
  const to = Date.parse(`${toKey}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / 86_400_000)
}

function dateKey(value: string | null): string | null {
  if (!value) return null
  const key = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

export function classifyDeposit(
  deposit: MercuryDeposit,
  options: { incomeAccountIds: readonly string[]; appliedReferences: ReadonlySet<string> },
): { kind: 'candidate' } | { kind: 'already_applied' } | { kind: 'ignored'; reason: DepositIgnoreReason } {
  if (deposit.amountCents <= 0) return { kind: 'ignored', reason: 'not_a_credit' }
  if (!options.incomeAccountIds.includes(deposit.accountId)) return { kind: 'ignored', reason: 'wrong_account' }
  if (deposit.kind === 'internalTransfer') return { kind: 'ignored', reason: 'internal_transfer' }
  if (deposit.kind === 'creditCardTransaction') return { kind: 'ignored', reason: 'card_activity' }

  const counterparty = `${deposit.counterpartyName ?? ''} ${deposit.bankDescription ?? ''}`.trim()
  if (HOUSE_COUNTERPARTY_PATTERNS.some(pattern => pattern.test(counterparty))) {
    return { kind: 'ignored', reason: 'house_credit' }
  }
  if (UNSETTLED_STATUSES.has(deposit.status)) return { kind: 'ignored', reason: 'not_settled' }
  // A pending ACH can still reverse. Shown, so it is not a surprise later, but
  // never offered as something to post.
  if (deposit.status === 'pending') return { kind: 'ignored', reason: 'pending_settlement' }
  if (options.appliedReferences.has(mercuryReference(deposit.transactionId))) return { kind: 'already_applied' }
  return { kind: 'candidate' }
}

function scoreCandidate(
  deposit: MercuryDeposit,
  invoice: OpenInvoice,
  context: { onlyOpenInvoice: boolean; dateWindowDays: number },
): MatchCandidate | null {
  const reasons: MatchReason[] = []
  let score = 0

  // Amount is the gate. No fuzzy amount matching: "close enough" on a bank feed
  // is how the wrong payment gets posted.
  if (deposit.amountCents === invoice.balanceCents) {
    score += 100
    reasons.push('amount_equals_balance')
  } else if (deposit.amountCents === invoice.subtotalCents) {
    score += 60
    reasons.push('amount_equals_subtotal')
  }

  const similarity = nameSimilarity(
    normalizePayerName(deposit.counterpartyName),
    normalizePayerName(invoice.billToName ?? invoice.clientName),
  )
  if (similarity >= 0.8) {
    score += 40
    reasons.push('name_strong')
  } else if (similarity >= 0.5) {
    score += 20
    reasons.push('name_partial')
  } else {
    const payerTokens = new Set(normalizePayerName(deposit.counterpartyName))
    const invoiceTokens = normalizePayerName(invoice.billToName ?? invoice.clientName)
    const surname = invoiceTokens.at(-1)
    if (surname && payerTokens.has(surname)) {
      score += 10
      reasons.push('name_surname')
    }
  }

  let capped = false
  const posted = dateKey(deposit.postedAt)
  const issued = dateKey(invoice.issueDate)
  if (posted && issued) {
    const gap = daysBetween(issued, posted)
    if (gap !== null) {
      if (gap >= 0 && gap <= context.dateWindowDays) {
        score += 15
        reasons.push('within_date_window')
      } else if (gap < -2) {
        // A client can wire before the invoice is cut, so this is a penalty and
        // a confidence ceiling rather than a disqualification — excluding it
        // outright would hide real money.
        score -= 50
        capped = true
        reasons.push('posted_before_issue')
      }
    }
  }

  if (context.onlyOpenInvoice) {
    score += 5
    reasons.push('only_open_invoice')
  }

  if (score < SCORE_FLOOR) return null

  const amountExact = reasons.includes('amount_equals_balance')
  const namedAtAll = reasons.includes('name_strong') || reasons.includes('name_partial') || reasons.includes('name_surname')
  let confidence: MatchConfidence = 'possible'
  if (amountExact && namedAtAll) confidence = 'exact'
  else if (amountExact || (reasons.includes('amount_equals_subtotal') && namedAtAll)) confidence = 'probable'
  if (capped) confidence = 'possible'

  return {
    invoiceId: invoice.invoiceId,
    number: invoice.number,
    matterId: invoice.matterId,
    clientName: invoice.clientName,
    balanceCents: invoice.balanceCents,
    confidence,
    score,
    reasons,
  }
}

export function proposeDepositMatches(input: {
  deposits: readonly MercuryDeposit[]
  invoices: readonly OpenInvoice[]
  incomeAccountIds: readonly string[]
  appliedReferences: ReadonlySet<string>
  dateWindowDays?: number
}): DepositProposal[] {
  const dateWindowDays = input.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS
  const onlyOpenInvoice = input.invoices.length === 1

  const proposals: DepositProposal[] = input.deposits.map(deposit => {
    const classified = classifyDeposit(deposit, {
      incomeAccountIds: input.incomeAccountIds,
      appliedReferences: input.appliedReferences,
    })
    if (classified.kind === 'ignored') {
      return { deposit, status: 'ignored' as const, ignoreReason: classified.reason, candidates: [] }
    }
    if (classified.kind === 'already_applied') {
      return { deposit, status: 'already_applied' as const, ignoreReason: null, candidates: [] }
    }

    const candidates = input.invoices
      .map(invoice => scoreCandidate(deposit, invoice, { onlyOpenInvoice, dateWindowDays }))
      .filter((candidate): candidate is MatchCandidate => candidate !== null)
      .sort((a, b) => b.score - a.score || a.invoiceId.localeCompare(b.invoiceId))

    if (candidates.length === 0) {
      return { deposit, status: 'unmatched' as const, ignoreReason: null, candidates: [] }
    }

    const [best, runnerUp] = candidates
    // A near-tie is a question, not a winner. Identical amounts are common in a
    // flat-fee practice, so this fires in ordinary use.
    const tied = runnerUp !== undefined && best.score - runnerUp.score < TIE_MARGIN
    // A name-only match must never read as a decision the software made.
    const weak = best.confidence === 'possible'
    return {
      deposit,
      status: (tied || weak ? 'ambiguous' : 'proposed') as DepositStatus,
      ignoreReason: null,
      candidates,
    }
  })

  return withoutContendedInvoices(proposals)
}

/**
 * Stop two deposits claiming the same invoice.
 *
 * Without this, two identical deposits both "match" one open balance and the
 * payment RPC's over-balance exception ends up doing the user interface's job.
 */
function withoutContendedInvoices(proposals: readonly DepositProposal[]): DepositProposal[] {
  const claimedBy = new Map<string, number>()
  const contended = new Set<number>()

  proposals.forEach((proposal, index) => {
    if (proposal.status !== 'proposed') return
    const invoiceId = proposal.candidates[0]?.invoiceId
    if (!invoiceId) return
    const holder = claimedBy.get(invoiceId)
    if (holder === undefined) {
      claimedBy.set(invoiceId, index)
      return
    }
    contended.add(holder)
    contended.add(index)
  })

  if (contended.size === 0) return [...proposals]
  return proposals.map((proposal, index) => (
    contended.has(index) ? { ...proposal, status: 'ambiguous' as DepositStatus } : proposal
  ))
}
