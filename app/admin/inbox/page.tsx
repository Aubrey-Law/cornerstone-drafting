import { isSmsConfigured } from '@/lib/communications/config'
import { fetchInboxThreads, fetchUnlinkedInboxCalls } from '@/lib/queries/inbox'
import type { InboxThread } from '@/lib/comms/thread'
import type { LinkedCallRow } from '@/components/calls/types'
import { InboxClient } from './InboxClient'

export const dynamic = 'force-dynamic'

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; channel?: string }>
}) {
  // Auth + role are enforced by the admin layout (as on /admin/tasks); the
  // triage endpoints re-check with requireAdmin on every call.
  let threads: InboxThread[] = []
  let unlinkedCalls: LinkedCallRow[] = []
  const [threadsResult, callsResult] = await Promise.allSettled([
    fetchInboxThreads({ limit: 50 }),
    fetchUnlinkedInboxCalls(),
  ])
  if (threadsResult.status === 'fulfilled') threads = threadsResult.value
  else console.error('inbox initial threads error:', threadsResult.reason)
  if (callsResult.status === 'fulfilled') unlinkedCalls = callsResult.value
  else console.error('inbox unlinked calls error:', callsResult.reason)

  const params = await searchParams
  const initialScope = params.scope === 'all' || params.scope === 'snoozed' || params.scope === 'unlinked_calls'
    ? params.scope
    : 'needs_reply'
  const initialChannel = params.channel === 'portal' || params.channel === 'sms' || params.channel === 'email' || params.channel === 'calls'
    ? params.channel
    : 'all'

  return (
    <InboxClient
      initialThreads={threads}
      initialUnlinkedCalls={unlinkedCalls}
      initialScope={initialScope}
      initialChannel={initialChannel}
      smsConfigured={isSmsConfigured()}
    />
  )
}
