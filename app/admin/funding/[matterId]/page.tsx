import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/funding/format'
import { fundingSummary } from '@/lib/funding/model'
import { loadFundingRows } from '@/lib/funding/repository'
import { toFundingAssets } from '@/lib/funding/rollup'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { AssetRow } from './AssetRow'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Trust funding' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function BackToFunding() {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href="/admin/funding">
        <ArrowLeft className="size-4" aria-hidden />
        All funding
      </Link>
    </Button>
  )
}

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
      <div className="space-y-4">
        <PageHeader
          title="Trust funding"
          description={
            <>
              Funding is tracked for hired matters against the assets listed at intake. This matter has none
              to track yet.{' '}
              <Link href={`/admin/matters/${matterId}?tab=assets`} className="font-medium text-primary hover:underline">
                Back to its assets
              </Link>
            </>
          }
          actions={<BackToFunding />}
        />
      </div>
    )
  }

  const assets = toFundingAssets(rows)
  const summary = fundingSummary(assets)

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Trust funding"
        title={rows[0].matter_title ?? 'Matter'}
        description={
          summary.isComplete ? (
            'Every asset is confirmed or deliberately excluded.'
          ) : (
            <>
              <span className="font-medium text-foreground">{formatMoney(summary.unfundedValue)}</span> across{' '}
              {summary.unfundedCount} of {summary.total} {summary.total === 1 ? 'asset' : 'assets'} is still
              outside the plan.
            </>
          )
        }
        actions={
          <>
            <BackToFunding />
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/matters/${matterId}?tab=assets`}>Open matter</Link>
            </Button>
          </>
        }
      />

      <Card className="gap-0 py-0">
        <ul className="divide-y divide-border">
          {assets.map(asset => (
            <AssetRow key={asset.assetId} matterId={matterId} asset={asset} />
          ))}
        </ul>
      </Card>
    </div>
  )
}
