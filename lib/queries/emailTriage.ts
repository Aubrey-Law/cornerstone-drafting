import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Reads for the triage page. Server-side only, through the service-role client,
 * like every other module in `lib/queries`.
 */

export type TriageStatus =
  | 'needs_reply'
  | 'drafting'
  | 'drafted'
  | 'approved'
  | 'dismissed'
  | 'replied'
  | 'failed'

export type TriageClassification = 'client' | 'lead' | 'contact' | 'possible_lead'

export interface EmailTriageRow {
  id: string
  gmail_thread_id: string
  gmail_message_id: string
  sender_email: string
  sender_name: string | null
  subject: string | null
  snippet: string | null
  received_at: string
  classification: TriageClassification
  classification_reason: string | null
  client_intake_id: string | null
  matter_id: string | null
  contact_id: string | null
  status: TriageStatus
  draft_subject: string | null
  draft_body: string | null
  draft_error: string | null
  gmail_draft_id: string | null
  gmail_draft_message_id: string | null
}

export interface TriageScanRow {
  id: string
  trigger: 'cron' | 'manual'
  started_at: string
  finished_at: string | null
  threads_queued: number
  drafts_generated: number
  error: string | null
}

const ROW_COLUMNS =
  'id, gmail_thread_id, gmail_message_id, sender_email, sender_name, subject, snippet, '
  + 'received_at, classification, classification_reason, client_intake_id, matter_id, '
  + 'contact_id, status, draft_subject, draft_body, draft_error, gmail_draft_id, '
  + 'gmail_draft_message_id'

/**
 * The queue, oldest inbound first.
 *
 * Oldest first is deliberate and is the opposite of an inbox: the client who
 * has waited longest is the one the reply is most overdue to, and burying them
 * under this morning's mail is the failure this page exists to prevent.
 *
 * Resolved states are excluded — `replied` and `dismissed` rows are history,
 * kept so a rescan does not resurrect them.
 */
export async function fetchEmailTriageQueue(): Promise<EmailTriageRow[]> {
  const { data, error } = await getAdminClient()
    .from('email_triage_threads')
    .select(ROW_COLUMNS)
    .in('status', ['needs_reply', 'drafting', 'drafted', 'failed', 'approved'])
    .order('received_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []) as unknown as EmailTriageRow[]
}

export async function fetchEmailTriageRow(id: string): Promise<EmailTriageRow | null> {
  const { data, error } = await getAdminClient()
    .from('email_triage_threads')
    .select(ROW_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as EmailTriageRow | null) ?? null
}

/** The last run, for the "scanned 12 minutes ago" line. */
export async function fetchLastTriageScan(): Promise<TriageScanRow | null> {
  const { data, error } = await getAdminClient()
    .from('email_triage_scans')
    .select('id, trigger, started_at, finished_at, threads_queued, drafts_generated, error')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as TriageScanRow | null) ?? null
}

/** Whether the feature is switched on at all. */
export async function fetchTriageEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('email_triage_enabled')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return Boolean((data as { email_triage_enabled?: boolean } | null)?.email_triage_enabled)
}
