import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { fetchPortalAssets } from '@/lib/funding/portalServer'
import { getFirmConfig } from '@/lib/firmConfig'
import { Button } from '@/components/ui/button'
import { PortalPageHeader } from '../PortalPageHeader'
import AssetsClient from './AssetsClient'

export const dynamic = 'force-dynamic'

const firm = getFirmConfig()

/**
 * Your assets: what the plan covers, what each one needs, and the two things
 * only the client can do about it: tell us about an asset we do not know, and
 * send the institution's confirmation once a step is done.
 */
export default async function PortalAssetsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const matter = await getMatterForUser(supabase, user.id)
  if (!matter) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Your assets are not ready yet</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Once your intake is reviewed and your matter is set up, the assets your plan covers will appear here.
          </p>
          <Button asChild className="mt-5" size="sm">
            <Link href="/dashboard">Return to dashboard</Link>
          </Button>
        </div>
      </div>
    )
  }

  let assets = null as Awaited<ReturnType<typeof fetchPortalAssets>> | null
  try {
    assets = await fetchPortalAssets(matter.id)
  } catch {
    assets = null
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PortalPageHeader
        title="Your assets"
        description={`What your plan covers and what each asset still needs. Tell ${firm.firmName} about anything we are missing, and send us the institution's confirmation once a step is done.`}
      />
      {assets === null ? (
        <p role="alert" className="text-sm text-destructive">
          Your assets are temporarily unavailable. <Link href="/assets" className="underline">Retry</Link>
        </p>
      ) : (
        <AssetsClient matterId={matter.id} matterClosed={matter.status === 'closed'} initialAssets={assets} />
      )}
    </div>
  )
}
