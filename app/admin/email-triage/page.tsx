import { redirect } from 'next/navigation'
import { getCachedClaims } from '@/lib/supabaseServer'
import { getGoogleConnectionForUser, hasGmailModifyScope } from '@/lib/googleCalendar'
import {
  fetchEmailTriageQueue,
  fetchLastTriageScan,
  fetchTriageEnabled,
} from '@/lib/queries/emailTriage'
import { TRIAGE_LISTING_CEILING } from '@/lib/emailTriage/scan'
import { EmailTriageClient } from './EmailTriageClient'

export const dynamic = 'force-dynamic'

export default async function EmailTriagePage() {
  const user = await getCachedClaims()
  if (!user) redirect('/auth/login')

  const [rows, scan, enabled, connection] = await Promise.all([
    fetchEmailTriageQueue(),
    fetchLastTriageScan(),
    fetchTriageEnabled(),
    getGoogleConnectionForUser(user.id),
  ])

  return (
    <EmailTriageClient
      initialRows={rows}
      initialScan={scan}
      enabled={enabled}
      connected={Boolean(connection)}
      mailbox={connection?.email ?? null}
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
