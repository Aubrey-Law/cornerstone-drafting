'use client'

import { useMemo } from 'react'
import { formatAssetCurrency } from '@/lib/assets/format'
import type { AssetAggregates } from '@/lib/assets/aggregates'
import { estimatePortfolioEstateTaxes } from '@/lib/estateTax'

interface AssetPortfolioSummaryProps {
  aggregates: AssetAggregates
  married?: boolean
}

export function AssetPortfolioSummary({ aggregates, married = false }: AssetPortfolioSummaryProps) {
  const { grossValue, netValue, valuedAssetCount, documentRecordCount } = aggregates

  const { federal, massachusetts } = useMemo(
    () => estimatePortfolioEstateTaxes(grossValue, { married }),
    [grossValue, married],
  )

  return (
    <div className="flex flex-col justify-center gap-4 py-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Total estimated value</p>
        <p className="text-2xl font-semibold tracking-tight text-foreground">
          {formatAssetCurrency(grossValue)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          based on {valuedAssetCount} valued asset{valuedAssetCount === 1 ? '' : 's'}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Net portfolio value</p>
        <p className="text-xl font-semibold text-foreground">{formatAssetCurrency(netValue)}</p>
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Estimated Federal Estate Tax</p>
            <p className="text-sm font-semibold text-foreground">{formatAssetCurrency(federal)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Estimated Massachusetts Estate Tax</p>
            <p className="text-sm font-semibold text-foreground">{formatAssetCurrency(massachusetts)}</p>
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Document records</p>
        <p className="text-sm text-foreground">
          {documentRecordCount} uploaded asset document{documentRecordCount === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  )
}
