import { isSmsConfigured } from '@/lib/communications/config'
import { fetchInboxThreads } from '@/lib/queries/inbox'
import type { InboxThread } from '@/lib/comms/thread'
import { InboxClient } from './InboxClient'

export const dynamic = 'force-dynamic'

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; channel?: string }>
}) {
  // Auth + role are enforced by the admin layout (as on /admin/tasks); the
  // thread endpoints re-check with requireAdmin on every call.
  let threads: InboxThread[] = []
  try {
    threads = await fetchInboxThreads({ limit: 50 })
  } catch (error) {
    console.error('inbox initial threads error:', error)
  }

  const params = await searchParams
  const initialScope = params.scope === 'all' || params.scope === 'snoozed'
    ? params.scope
    : 'needs_reply'
  const initialChannel = params.channel === 'portal' || params.channel === 'sms' || params.channel === 'email'
    ? params.channel
    : 'all'

  return (
    <InboxClient
      initialThreads={threads}
      initialScope={initialScope}
      initialChannel={initialChannel}
      smsConfigured={isSmsConfigured()}
    />
  )
}
