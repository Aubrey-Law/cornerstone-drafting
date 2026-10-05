import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { listDelegatedActivity, listPendingDelegatedProposals } from '@/lib/actions/delegation'
import { getCachedClaims } from '@/lib/supabaseServer'
import { ApprovalInbox, type ApprovalProposal } from '@/app/admin/components/ApprovalInbox'
import { DelegatedActivityList } from '@/app/admin/components/DelegatedActivityList'

/**
 * "Done for you": what the delegation dial did on its own in the last day,
 * with undo where the action has one, and what it left waiting for a click.
 * Renders nothing when there is neither, so a firm that keeps everything on
 * "Propose" and has no unattended runs never sees it.
 */
export async function DelegatedActivityCard({ hours = 24, includeExplicitApprovals = true }: { hours?: number; includeExplicitApprovals?: boolean }) {
  let activity: Awaited<ReturnType<typeof listDelegatedActivity>>
  let pending: ApprovalProposal[] = []
  try {
    const auth = await getCachedClaims()
    const [done, waiting] = await Promise.all([
      listDelegatedActivity({ since: new Date(Date.now() - hours * 3_600_000) }),
      auth ? listPendingDelegatedProposals(auth.id, { includeExplicit: includeExplicitApprovals }) : Promise.resolve([]),
    ])
    activity = done
    pending = waiting as ApprovalProposal[]
  } catch {
    return null
  }
  if (activity.done.length === 0 && activity.observed.length === 0 && pending.length === 0) return null
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
      {pending.length ? (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waiting for you</p>
          <div className="mt-1">
            <ApprovalInbox initialProposals={pending} emptyMessage="" />
          </div>
        </div>
      ) : null}
      {activity.done.length || activity.observed.length ? (
        <div className="mt-2">
          <DelegatedActivityList done={activity.done} observed={activity.observed} />
        </div>
      ) : null}
    </section>
  )
}
