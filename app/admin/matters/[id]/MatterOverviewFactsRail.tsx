import Link from 'next/link'
import { formatAssetCurrency } from '@/lib/assets/format'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import type { MatterDetailsRow } from '@/types/matter-details'

function FactRow({
  label,
  children,
  emphasized = false,
}: {
  label: string
  children: React.ReactNode
  emphasized?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={emphasized ? 'text-right text-sm font-semibold tabular-nums' : 'text-right text-sm'}>
        {children}
      </dd>
    </div>
  )
}

function paymentStatusLabel(status: MatterDetailsRow['fee_payment_status'], paid: boolean | null | undefined) {
  if (status === 'deposit') return 'Deposit'
  if (status === 'paid_in_full' || paid) return 'Paid in full'
  return 'Unpaid'
}

function taxDecisionLabel(value: boolean | null | undefined) {
  if (value === true) return 'Tax-sensitive'
  if (value === false) return 'Not tax-sensitive'
  return 'Not reviewed'
}

export function MatterOverviewFactsRail({
  matterId,
  details,
  designSheetPlanType,
  estate,
}: {
  matterId: string
  details: MatterDetailsRow | null
  designSheetPlanType: string | null
  estate: MatterEstateSnapshot
}) {
  const updatedLabel = estate.latestAssetUpdatedAt
    ? new Date(estate.latestAssetUpdatedAt).toLocaleDateString()
    : 'No asset inventory'

  return (
    <aside className="h-fit rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Matter facts</h3>
        <Link
          href={`/admin/drafting/${matterId}?step=design`}
          className="text-xs font-medium text-accent hover:underline"
        >
          Open design
        </Link>
      </div>
      <dl className="mt-3">
        <FactRow label="Plan">
          {designSheetPlanType ? designPlanTypeLabel(designSheetPlanType) : details?.plan_type || '—'}
        </FactRow>
        <FactRow label="Flat fee">
          {details?.flat_fee_amount == null ? '—' : formatAssetCurrency(details.flat_fee_amount)}
        </FactRow>
        <FactRow label="Payment">
          {paymentStatusLabel(details?.fee_payment_status, details?.fee_collected)}
        </FactRow>
        <FactRow label="Owned assets">{formatAssetCurrency(estate.ownedAssetValue)}</FactRow>
        <FactRow label="Death benefit">{formatAssetCurrency(estate.deathBenefit)}</FactRow>
        <FactRow label="Gross estate estimate" emphasized>
          {formatAssetCurrency(estate.grossEstateEstimate)}
        </FactRow>
        <FactRow label="Estimated MA tax" emphasized>
          {formatAssetCurrency(estate.estimatedMaTax)}
        </FactRow>
        <FactRow label="Attorney decision">
          {taxDecisionLabel(details?.ep_ma_estate_taxable)}
        </FactRow>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Inventory estimate from {estate.assetCount} asset{estate.assetCount === 1 ? '' : 's'} · {updatedLabel}.
        All listed life-insurance death benefits are included pending attorney review.
      </p>
    </aside>
  )
}
