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

  const { federal, massachusetts, federalLookup } = useMemo(
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
        <p className="text-micro text-muted-foreground">
          based on {valuedAssetCount} valued asset{valuedAssetCount === 1 ? '' : 's'}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Net portfolio value</p>
        <p className="text-xl font-semibold text-foreground">{formatAssetCurrency(netValue)}</p>
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <div>
            <p className="text-micro font-medium text-muted-foreground">Estimated Federal Estate Tax</p>
            {federal === null ? (
              /*
               * No figure rather than a wrong one. formatAssetCurrency turns
               * null into "$0", which on a multi-million-dollar estate is a
               * confident answer that happens to be false — the exact failure
               * dated schedules exist to prevent.
               */
              <>
                <p className="text-sm font-semibold text-amber">
                  Not on file
                </p>
                <p className="text-micro text-muted-foreground">
                  {!federalLookup.ok && federalLookup.mostRecent
                    ? `No federal exclusion recorded for ${federalLookup.asOf.slice(0, 4)}; the most recent on file is ${federalLookup.mostRecent.effectiveFrom.slice(0, 4)}. Add this year's figure in firm settings.`
                    : 'Add the federal exclusion for this year in firm settings.'}
                </p>
              </>
            ) : (
              <p className="text-sm font-semibold text-foreground">{formatAssetCurrency(federal)}</p>
            )}
          </div>
          <div>
            <p className="text-micro font-medium text-muted-foreground">Estimated Massachusetts Estate Tax</p>
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
