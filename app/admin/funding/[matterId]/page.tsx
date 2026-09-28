import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatMoney } from '@/lib/funding/format'
import { fundingSummary } from '@/lib/funding/model'
import { loadFundingRows } from '@/lib/funding/repository'
import { toFundingAssets } from '@/lib/funding/rollup'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { AssetRow } from './AssetRow'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One matter's funding: each asset the client listed at intake, how it joins
 * the trust, and whether the institution has confirmed it. Ported from the
 * workbench's `/funding/[matterId]`.
 */
export default async function MatterFundingPage({ params }: { params: Promise<{ matterId: string }> }) {
  await requireStaffPage()

  const { matterId } = await params
  if (!UUID.test(matterId)) notFound()

  const rows = await loadFundingRows(reviewClient(), { matterId })
  // Not a 404: the Assets tab links here for every matter, including ones
  // not yet hired or with nothing listed at intake.
  if (rows.length === 0) {
    return (
      <div className="space-y-2 px-6 py-5">
        <Link href="/admin/funding" className="text-xs text-muted-foreground underline underline-offset-4">
          Funding
        </Link>
        <p className="text-sm text-muted-foreground">
          Funding is tracked for hired matters against the assets listed at intake. This matter has none
          to track yet.{' '}
          <Link href={`/admin/matters/${matterId}?tab=assets`} className="underline underline-offset-4">
            Back to its assets
          </Link>
        </p>
      </div>
    )
  }

  const assets = toFundingAssets(rows)
  const summary = fundingSummary(assets)

  return (
    <div className="space-y-4 px-6 py-5">
      <header className="space-y-1">
        <Link href="/admin/funding" className="text-xs text-muted-foreground underline underline-offset-4">
          Funding
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          <Link href={`/admin/matters/${matterId}?tab=assets`} className="hover:underline">
            {rows[0].matter_title ?? 'Matter'}
          </Link>
        </h1>
        <p className="text-sm text-muted-foreground">
          {summary.isComplete ? (
            'Every asset is confirmed or deliberately excluded.'
          ) : (
            <>
              <span className="font-medium text-foreground">{formatMoney(summary.unfundedValue)}</span> across{' '}
              {summary.unfundedCount} of {summary.total} {summary.total === 1 ? 'asset' : 'assets'} is still
              outside the plan.
            </>
          )}
        </p>
      </header>

      <ul className="divide-y divide-border border-y border-border">
        {assets.map(asset => (
          <AssetRow key={asset.assetId} matterId={matterId} asset={asset} />
        ))}
      </ul>
    </div>
  )
}
