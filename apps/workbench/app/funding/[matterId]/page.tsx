import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { formatMoney } from '@/lib/funding/format'
import { fundingSummary } from '@/lib/funding/model'
import { loadFundingRows } from '@/lib/funding/repository'
import { toFundingAssets } from '@/lib/funding/rollup'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { AssetRow } from './AssetRow'

export const metadata = { title: 'Funding · Aubrey Law Workbench' }

export default async function MatterFundingPage({
  params,
}: {
  params: Promise<{ matterId: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const { matterId } = await params
  const rows = await loadFundingRows(getAdminClient(), { matterId })
  if (rows.length === 0) notFound()

  const assets = toFundingAssets(rows)
  const summary = fundingSummary(assets)

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-8 space-y-2">
        <Link href="/funding" className="text-xs text-muted-foreground underline underline-offset-4">
          Funding
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{rows[0].matter_title ?? 'Matter'}</h1>
        <p className="text-muted-foreground">
          {summary.isComplete ? (
            'Every asset is confirmed or deliberately excluded.'
          ) : (
            <>
              <span className="font-medium text-foreground">
                {formatMoney(summary.unfundedValue)}
              </span>{' '}
              across {summary.unfundedCount} of {summary.total}{' '}
              {summary.total === 1 ? 'asset' : 'assets'} is still outside the plan.
            </>
          )}
        </p>
      </div>

      <ul className="divide-y divide-border border-y border-border">
        {assets.map((asset) => (
          <AssetRow key={asset.assetId} matterId={matterId} asset={asset} />
        ))}
      </ul>
    </main>
  )
}
