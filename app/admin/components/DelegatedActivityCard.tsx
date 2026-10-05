import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { listDelegatedActivity } from '@/lib/actions/delegation'
import { DelegatedActivityList } from '@/app/admin/components/DelegatedActivityList'

/**
 * "Done for you": what the delegation dial did on its own in the last day,
 * with undo where the action has one. Renders nothing when the dial has not
 * acted, so a firm that keeps everything on "Propose" never sees it.
 */
export async function DelegatedActivityCard({ hours = 24 }: { hours?: number }) {
  let activity: Awaited<ReturnType<typeof listDelegatedActivity>>
  try {
    activity = await listDelegatedActivity({ since: new Date(Date.now() - hours * 3_600_000) })
  } catch {
    return null
  }
  if (activity.done.length === 0 && activity.observed.length === 0) return null
  return (
    <section className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
          Done for you
        </h2>
        <Link href="/admin/settings?tab=delegation" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Delegation settings
        </Link>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">Taken on its own in the last {hours} hours under your delegation settings.</p>
      <div className="mt-2">
        <DelegatedActivityList done={activity.done} observed={activity.observed} />
      </div>
    </section>
  )
}
