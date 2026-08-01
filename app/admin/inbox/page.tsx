import { isSmsConfigured, isVoiceConfigured } from '@/lib/communications/config'
import { fetchInboxThreads } from '@/lib/queries/inbox'
import type { InboxThread } from '@/lib/comms/thread'
import { InboxClient } from './InboxClient'

export const dynamic = 'force-dynamic'

export default async function AdminInboxPage() {
  // Auth + role are enforced by the admin layout (as on /admin/tasks); the
  // triage endpoints re-check with requireAdmin on every call.
  let threads: InboxThread[] = []
  try {
    threads = await fetchInboxThreads({ limit: 50 })
  } catch (error) {
    // The page still renders (empty) if the view is missing or unreachable.
    console.error('inbox initial threads error:', error)
  }

  return (
    <InboxClient
      initialThreads={threads}
      smsConfigured={isSmsConfigured()}
      voiceConfigured={isVoiceConfigured()}
    />
  )
}
