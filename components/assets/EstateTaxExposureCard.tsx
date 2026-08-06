'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { formatAssetCurrency } from '@/lib/assets/format'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import { cn } from '@/lib/utils'

interface EstateTaxExposureCardProps {
  estate: MatterEstateSnapshot
  anticipatedInheritance: boolean
  onAnticipatedInheritanceChange: (next: boolean) => void
}

function Figure({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: 'amber' | 'green'
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums',
          emphasis === 'amber' && 'text-amber',
          emphasis === 'green' && 'text-green',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * The four numbers the design meeting actually turns on: what the estate is,
 * what Massachusetts takes with no planning, what it takes with a credit
 * shelter, and the gap between them. All from lib/estateTax — the credit table
 * lives in one place.
 */
export function EstateTaxExposureCard({
  estate,
  anticipatedInheritance,
  onAnticipatedInheritanceChange,
}: EstateTaxExposureCardProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Massachusetts estate tax exposure</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Gross estate" value={formatAssetCurrency(estate.grossEstateEstimate)} />
          <Figure
            label="MA tax, no planning"
            value={formatAssetCurrency(estate.estimatedMaTax)}
            emphasis="amber"
          />
          <Figure
            label="MA tax, credit shelter"
            value={formatAssetCurrency(estate.maTaxWithCreditShelter)}
          />
          <Figure
            label="Difference"
            value={formatAssetCurrency(estate.creditShelterSavings)}
            hint="What the second trust saves"
            emphasis="green"
          />
        </div>

        <dl className="grid gap-x-6 gap-y-2 border-t border-border pt-3 text-sm sm:grid-cols-3">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Life insurance face</dt>
            <dd className="tabular-nums">{formatAssetCurrency(estate.lifeInsuranceFace)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Business interests</dt>
            <dd className="tabular-nums">{formatAssetCurrency(estate.businessInterests)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Estate less policy face</dt>
            <dd className="tabular-nums">
              {formatAssetCurrency(estate.estateExcludingLifeInsurance)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Policy face value is reported beside the estate, not netted out of it — a policy
          the client still owns is in their taxable estate until an ILIT holds it.
        </p>

        <label className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm">
            Anticipated inheritance
            <span className="block text-xs text-muted-foreground">
              Money expected to arrive, changing the exposure this plan is designed against.
            </span>
          </span>
          <Switch
            checked={anticipatedInheritance}
            onCheckedChange={onAnticipatedInheritanceChange}
            aria-label="Anticipated inheritance"
          />
        </label>
      </CardContent>
    </Card>
  )
}
