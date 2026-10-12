import { getMailboxIdentity } from '@/lib/email/gmailRead'
import { applyAndRecordMailboxSort, loadArchiveNonClientEnabled } from '@/lib/emailTriage/mailboxSort'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Restore Inbox + Follow-up label for threads whose follow-up reminder is due.
 * Called from the triage cron after the scan so overdue follow-ups reappear in
 * Gmail without waiting for the attorney to open Mail Desk.
 */
export async function wakeDueEmailFollowUps(userId: string | null): Promise<{ woke: number }> {
  const admin = getAdminClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('email_triage_threads')
    .select('id, gmail_thread_id, classification, gmail_sort_label')
    .not('follow_up_at', 'is', null)
    .lte('follow_up_at', nowIso)
    .limit(50)
  if (error) throw error

  const rows = (data ?? []) as {
    id: string
    gmail_thread_id: string
    classification: 'client' | 'lead' | 'contact' | 'possible_lead'
    gmail_sort_label: string | null
  }[]
  if (rows.length === 0) return { woke: 0 }

  let identity
  try {
    identity = await getMailboxIdentity(userId)
  } catch {
    return { woke: 0 }
  }

  const archiveEnabled = await loadArchiveNonClientEnabled().catch(() => true)
  let woke = 0
  for (const row of rows) {
    if (row.gmail_sort_label === 'Cornerstone/Follow-up') continue
    const result = await applyAndRecordMailboxSort({
      token: identity.token,
      threadId: row.gmail_thread_id,
      kind: 'follow_up_due',
      classification: row.classification,
      archiveEnabled,
      triageRowId: row.id,
    })
    if (!result.error) woke += 1
  }
  return { woke }
}
