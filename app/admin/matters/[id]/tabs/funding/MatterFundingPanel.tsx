'use client'

import { useCallback, useEffect, useState } from 'react'
import { Landmark } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/funding/format'
import type { FundingSummary } from '@/lib/funding/model'
import type { FundingAsset } from '@/lib/funding/rollup'
import { AssetRow } from './AssetRow'

interface FundingView {
  assets: FundingAsset[]
  summary: FundingSummary
}

/**
 * The Funding view of a matter's Assets tab: each asset listed at intake, how
 * it joins the trust, and whether the institution has confirmed it. Loaded
 * when the view opens, and again after each save.
 */
export function MatterFundingPanel({ matterId }: { matterId: string }) {
  const [view, setView] = useState<FundingView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/funding`)
      const body = (await response.json().catch(() => ({}))) as Partial<FundingView> & { error?: string }
      if (!response.ok || !body.assets || !body.summary) {
        throw new Error(body.error ?? `Could not load funding (${response.status})`)
      }
      setView({ assets: body.assets, summary: body.summary })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load funding')
    }
  }, [matterId])

  useEffect(() => {
    setView(null)
    void load()
  }, [load])

  return (
    <Card className="gap-0 py-0" data-testid="matter-funding">
      <CardHeader className="block space-y-1 border-b py-3 [.border-b]:pb-3">
        <CardTitle className="text-sm">Trust funding</CardTitle>
        {view && view.assets.length > 0 ? (
          <CardDescription className="text-xs">
            {view.summary.isComplete ? (
              'Every asset is confirmed or deliberately excluded.'
            ) : (
              <>
                <span className="font-medium text-foreground">{formatMoney(view.summary.unfundedValue)}</span> across{' '}
                {view.summary.unfundedCount} of {view.summary.total}{' '}
                {view.summary.total === 1 ? 'asset' : 'assets'} is still outside the plan.
              </>
            )}
          </CardDescription>
        ) : null}
      </CardHeader>
      {error ? (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>
      ) : view === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Loading funding…</p>
      ) : view.assets.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Nothing to fund yet"
          description="Funding is tracked for hired matters against the assets listed at intake. This matter has none to track yet."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-border">
          {view.assets.map(asset => (
            <AssetRow key={asset.assetId} matterId={matterId} asset={asset} onSaved={() => void load()} />
          ))}
        </ul>
      )}
    </Card>
  )
}
