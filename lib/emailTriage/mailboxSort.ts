import {
  GmailLabelCache,
  sortMailboxThread,
} from '@/lib/email/gmailLabels'
import type { MailboxSortKind } from '@/lib/emailTriage/labels'
import type { TriageClassification } from '@/lib/queries/emailTriage'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Apply a Mail Desk Gmail sort and stamp the triage row when we have one.
 * Best-effort: callers should not fail an attorney action because Gmail
 * labelling hiccuped — report the error instead.
 */

export async function loadArchiveNonClientEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('email_triage_archive_non_client')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  const row = data as { email_triage_archive_non_client?: boolean } | null
  // Default on when the column is missing mid-migration.
  return row?.email_triage_archive_non_client !== false
}

export async function applyAndRecordMailboxSort(args: {
  token: string
  threadId: string
  kind: MailboxSortKind
  classification?: TriageClassification | 'automated' | 'internal'
  archiveEnabled: boolean
  automatedHard?: boolean
  /** When set, stamp gmail_sorted_at / gmail_sort_label on this row. */
  triageRowId?: string | null
  cache?: GmailLabelCache
}): Promise<{ label: string | null; error: string | null }> {
  try {
    const label = await sortMailboxThread({
      token: args.token,
      threadId: args.threadId,
      kind: args.kind,
      classification: args.classification,
      archiveEnabled: args.archiveEnabled,
      automatedHard: args.automatedHard,
      cache: args.cache,
    })
    if (args.triageRowId) {
      const now = new Date().toISOString()
      await getAdminClient()
        .from('email_triage_threads')
        .update({
          gmail_sorted_at: now,
          gmail_sort_label: label,
          updated_at: now,
        })
        .eq('id', args.triageRowId)
    }
    return { label, error: null }
  } catch (err) {
    return { label: null, error: err instanceof Error ? err.message : String(err) }
  }
}
