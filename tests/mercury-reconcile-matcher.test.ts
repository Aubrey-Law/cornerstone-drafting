import { describe, expect, it } from 'vitest'
import {
  classifyDeposit, mercuryReference, normalizePayerName, proposeDepositMatches,
  type MercuryDeposit, type OpenInvoice,
} from '@/lib/integrations/mercury/reconcile'

const INCOME = '40e1b452-85d1-11f1-92ba-23367ea93847'
const OPEX = '32c294e2-2b49-11f0-9205-837057363052'

function deposit(overrides: Partial<MercuryDeposit> = {}): MercuryDeposit {
  return {
    transactionId: 'txn-1',
    accountId: INCOME,
    amountCents: 72_500,
    postedAt: '2026-08-20T12:00:00Z',
    counterpartyName: 'Lara Coakley',
    bankDescription: null,
    kind: 'externalTransfer',
    status: 'sent',
    ...overrides,
  }
}

function invoice(overrides: Partial<OpenInvoice> = {}): OpenInvoice {
  return {
    invoiceId: 'inv-1',
    number: 'INV-1002',
    matterId: 'matter-1',
    billToName: 'Lara Coakley',
    clientName: 'Lara Coakley',
    issueDate: '2026-08-14',
    subtotalCents: 72_500,
    balanceCents: 72_500,
    ...overrides,
  }
}

function propose(deposits: MercuryDeposit[], invoices: OpenInvoice[], applied: string[] = []) {
  return proposeDepositMatches({
    deposits,
    invoices,
    incomeAccountIds: [INCOME],
    appliedReferences: new Set(applied),
  })
}

/**
 * The filtering cases come from a real 15-transaction sample off the firm's
 * account, where most positive-amount rows were the firm's own money moving
 * between its Profit-First accounts rather than anything a client paid.
 */
describe('classifyDeposit', () => {
  const options = { incomeAccountIds: [INCOME], appliedReferences: new Set<string>() }

  it.each([
    ['money out', { amountCents: -3_800 }, 'not_a_credit'],
    ['a non-income account', { accountId: OPEX }, 'wrong_account'],
    ['an internal transfer', { kind: 'internalTransfer' }, 'internal_transfer'],
    ['card activity', { kind: 'creditCardTransaction' }, 'card_activity'],
    ['Mercury cashback', { counterpartyName: 'Mercury IO Cashback', kind: 'other' }, 'house_credit'],
    ['a payroll account credit', { counterpartyName: 'Mercury Checking ••0301', kind: 'other' }, 'house_credit'],
    ['a reversed payment', { status: 'reversed' }, 'not_settled'],
    ['a pending ACH', { status: 'pending' }, 'pending_settlement'],
  ])('ignores %s', (_label, overrides, reason) => {
    const result = classifyDeposit(deposit(overrides as Partial<MercuryDeposit>), options)
    expect(result).toEqual({ kind: 'ignored', reason })
  })

  it('accepts a settled external credit into the income account', () => {
    expect(classifyDeposit(deposit(), options)).toEqual({ kind: 'candidate' })
  })

  it('recognises a deposit already recorded against a payment', () => {
    const result = classifyDeposit(deposit(), {
      ...options,
      appliedReferences: new Set([mercuryReference('txn-1')]),
    })
    expect(result).toEqual({ kind: 'already_applied' })
  })
})

describe('the internal-transfer pair from the live sample', () => {
  it('proposes nothing for a matched +25 / -25 transfer between firm accounts', () => {
    const proposals = propose([
      deposit({ transactionId: 'in', amountCents: 2_500, kind: 'internalTransfer', counterpartyName: 'Mercury Checking ••0301' }),
      deposit({ transactionId: 'out', amountCents: -2_500, kind: 'internalTransfer', counterpartyName: 'Mercury Checking ••2536' }),
    ], [invoice({ balanceCents: 2_500, subtotalCents: 2_500 })])

    expect(proposals.every(row => row.status === 'ignored')).toBe(true)
    expect(proposals.flatMap(row => row.candidates)).toHaveLength(0)
  })

  it('ignores cashback credits even though they are positive amounts', () => {
    const proposals = propose([
      deposit({ transactionId: 'c1', amountCents: 18, kind: 'other', counterpartyName: 'Mercury IO Cashback' }),
      deposit({ transactionId: 'c2', amountCents: 56, kind: 'other', counterpartyName: 'Mercury IO Cashback' }),
    ], [invoice()])

    expect(proposals.map(row => row.ignoreReason)).toEqual(['house_credit', 'house_credit'])
  })
})

describe('proposeDepositMatches', () => {
  it('proposes an exact match on balance and name', () => {
    const [proposal] = propose([deposit()], [invoice()])
    expect(proposal.status).toBe('proposed')
    expect(proposal.candidates[0].confidence).toBe('exact')
    expect(proposal.candidates[0].reasons).toContain('amount_equals_balance')
    expect(proposal.candidates[0].reasons).toContain('name_strong')
  })

  it('asks rather than guesses when two invoices share the amount', () => {
    const [proposal] = propose([deposit({ counterpartyName: 'ACH CREDIT' })], [
      invoice({ invoiceId: 'inv-1', number: 'INV-1', billToName: 'Ann Reed', clientName: 'Ann Reed' }),
      invoice({ invoiceId: 'inv-2', number: 'INV-2', billToName: 'Bob Sands', clientName: 'Bob Sands' }),
    ])
    expect(proposal.status).toBe('ambiguous')
    expect(proposal.candidates).toHaveLength(2)
  })

  it('never lets a name-only similarity read as a decision', () => {
    const [proposal] = propose([deposit({ amountCents: 31_337 })], [invoice()])
    expect(proposal.status).not.toBe('proposed')
  })

  it('caps confidence when the money arrived before the invoice was issued', () => {
    const [proposal] = propose(
      [deposit({ postedAt: '2026-07-01T12:00:00Z' })],
      [invoice({ issueDate: '2026-08-14' })],
    )
    expect(proposal.candidates[0].reasons).toContain('posted_before_issue')
    expect(proposal.candidates[0].confidence).toBe('possible')
    expect(proposal.status).toBe('ambiguous')
  })

  it('reports a deposit with no plausible invoice as unmatched rather than hiding it', () => {
    const [proposal] = propose([deposit({ amountCents: 4_242, counterpartyName: 'Someone Else' })], [invoice()])
    expect(proposal.status).toBe('unmatched')
    expect(proposal.candidates).toHaveLength(0)
  })

  it('marks an already-recorded deposit instead of offering it twice', () => {
    const [proposal] = propose([deposit()], [invoice()], [mercuryReference('txn-1')])
    expect(proposal.status).toBe('already_applied')
  })

  /**
   * Without the contention pass both deposits claim the one open balance and
   * the payment RPC's over-balance guard ends up doing the interface's job.
   */
  it('refuses to let two deposits claim the same invoice', () => {
    const proposals = propose([
      deposit({ transactionId: 'txn-1' }),
      deposit({ transactionId: 'txn-2' }),
    ], [invoice()])

    expect(proposals.map(row => row.status)).toEqual(['ambiguous', 'ambiguous'])
  })

  it('is deterministic', () => {
    const run = () => propose([deposit(), deposit({ transactionId: 'txn-2', amountCents: 50_000 })], [
      invoice(), invoice({ invoiceId: 'inv-2', number: 'INV-2', balanceCents: 50_000, subtotalCents: 50_000 }),
    ])
    expect(run()).toStrictEqual(run())
  })

  it('reads no clock', () => {
    const source = require('node:fs').readFileSync('lib/integrations/mercury/reconcile.ts', 'utf8')
    expect(source).not.toMatch(/Date\.now\(\)|new Date\(\)/)
  })
})

describe('normalizePayerName', () => {
  it('drops entity noise so a trust matches the person who funded it', () => {
    expect(normalizePayerName('The Coakley Family Revocable Trust')).toEqual(['coakley'])
  })

  it('strips accents and punctuation', () => {
    expect(normalizePayerName('José  Álvarez-Ruiz, LLC')).toEqual(['jose', 'alvarez', 'ruiz'])
  })

  it('returns nothing for an absent payer', () => {
    expect(normalizePayerName(null)).toEqual([])
  })
})
