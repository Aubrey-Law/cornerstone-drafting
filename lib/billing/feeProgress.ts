import { isLegalPlanBilling } from '@/lib/billing/billingType'
import type { MatterDetailsRow } from '@/types/matter-details'

export interface MatterFeeProgress {
  isPlan: boolean
  /** Cents. The stated flat fee, or what the ledger billed for a plan claim. */
  expected: number
  collected: number
  balance: number
  /** 0–100 share of `expected` collected. */
  percent: number
}

/**
 * What is expected, what has arrived, and the gap. A flat fee is quoted before
 * the engagement seeds its ledger row, so the stated figure is the only answer
 * until then. A plan claim has no such window — it exists once it is in the
 * ledger, and the ledger is the answer. `flat_fee_amount` is dollars
 * (4500 = $4,500); the ledger works in cents. Balance is derived on every call —
 * storing it would create a second truth that drifts the moment a payment lands.
 */
export function matterFeeProgress(
  details: Pick<MatterDetailsRow, 'billing_type' | 'flat_fee_amount'> | null,
  billed: number,
  collected: number,
): MatterFeeProgress {
  const isPlan = isLegalPlanBilling(details?.billing_type)
  const stated = isPlan ? null : details?.flat_fee_amount
  const expected = typeof stated === 'number' && Number.isFinite(stated) ? Math.round(stated * 100) : billed
  const balance = expected - collected
  const percent = expected > 0 ? Math.max(0, Math.min(100, Math.round((collected / expected) * 100))) : 100
  return { isPlan, expected, collected, balance, percent }
}
