import { redirect } from 'next/navigation'
import { getCachedClaims } from '@/lib/supabaseServer'
import { getGoogleConnectionForUser, hasGmailModifyScope } from '@/lib/googleCalendar'
import {
  fetchEmailTriageQueue,
  fetchLastTriageScan,
  fetchTriageArchiveNonClient,
  fetchTriageEnabled,
  type TriageQueueView,
} from '@/lib/queries/emailTriage'
import { TRIAGE_LISTING_CEILING } from '@/lib/emailTriage/scan'
import { EmailTriageClient } from './EmailTriageClient'

export const dynamic = 'force-dynamic'

const VIEWS: TriageQueueView[] = [
  'all', 'client', 'lead', 'contact', 'possible_lead',
  'overdue', 'needs_draft', 'drafted', 'failed', 'snoozed', 'follow_up', 'mine',
]

export default async function EmailTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; thread?: string }>
}) {
  const user = await getCachedClaims()
  if (!user) redirect('/auth/login')

  const params = await searchParams
  const view = VIEWS.includes(params.view as TriageQueueView)
    ? (params.view as TriageQueueView)
    : 'all'

  const [rows, scan, enabled, archiveNonClient, connection] = await Promise.all([
    fetchEmailTriageQueue({ view, claimedBy: user.id }),
    fetchLastTriageScan(),
    fetchTriageEnabled(),
    fetchTriageArchiveNonClient(),
    getGoogleConnectionForUser(user.id),
  ])

  return (
    <EmailTriageClient
      initialRows={rows}
      initialScan={scan}
      initialView={view}
      enabled={enabled}
      archiveNonClient={archiveNonClient}
      connected={Boolean(connection)}
      mailbox={connection?.email ?? null}
      currentUserId={user.id}
      // An empty queue and a missing permission look identical on screen, so
      // the page is told which it is rather than left to imply the wrong one.
      hasReadScope={hasGmailModifyScope(connection?.scopes)}
      // The ceiling is a safety valve, not a window. Reaching it means Gmail
      // had more to say than one scan could take, so the queue may be missing
      // something — which is exactly the state that used to pass silently for
      // a healthy `threads_listed` count.
      listingTruncated={(scan?.threads_listed ?? 0) >= TRIAGE_LISTING_CEILING}
    />
  )
}
