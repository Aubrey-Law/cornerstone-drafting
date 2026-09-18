import type { MercuryTransaction } from './types'
import type { MercuryDeposit } from './reconcile'

/**
 * Mercury transaction to the shape the matcher reasons about. Pure, so the
 * matcher's fixtures can be written without touching the provider schema.
 */
export function toDeposit(transaction: MercuryTransaction): MercuryDeposit {
  return {
    transactionId: transaction.id,
    accountId: transaction.accountId,
    amountCents: transaction.amountCents,
    postedAt: transaction.postedAt ?? '',
    counterpartyName: transaction.counterpartyName ?? null,
    bankDescription: transaction.bankDescription ?? null,
    kind: transaction.kind,
    status: transaction.status,
  }
}
