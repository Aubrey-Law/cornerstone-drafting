import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Reads for the triage / Mail Desk page. Server-side only, through the
 * service-role client, like every other module in `lib/queries`.
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

export type TriageQueueView =
  | 'all'
  | 'client'
  | 'lead'
  | 'contact'
  | 'possible_lead'
  | 'overdue'
  | 'needs_draft'
  | 'drafted'
  | 'failed'
  | 'snoozed'
  | 'follow_up'
  | 'mine'

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
  /** Set when the attorney already has a reply to this thread open in Gmail. */
  human_draft_at: string | null
  snoozed_until: string | null
  follow_up_at: string | null
  follow_up_note: string | null
  claimed_by: string | null
  thread_note: string | null
  gmail_sorted_at: string | null
  gmail_sort_label: string | null
}

export interface TriageScanRow {
  id: string
  trigger: 'cron' | 'manual'
  started_at: string
  finished_at: string | null
  threads_queued: number
  drafts_generated: number
  /** Compared against TRIAGE_LISTING_CEILING to tell whether the window was cut short. */
  threads_listed: number
  error: string | null
}

const ROW_COLUMNS =
  'id, gmail_thread_id, gmail_message_id, sender_email, sender_name, subject, snippet, '
  + 'received_at, classification, classification_reason, client_intake_id, matter_id, '
  + 'contact_id, status, draft_subject, draft_body, draft_error, gmail_draft_id, '
  + 'gmail_draft_message_id, human_draft_at, snoozed_until, follow_up_at, follow_up_note, '
  + 'claimed_by, thread_note, gmail_sorted_at, gmail_sort_label'

const OPEN_STATUSES = ['needs_reply', 'drafting', 'drafted', 'failed', 'approved'] as const

export interface FetchEmailTriageQueueOptions {
  view?: TriageQueueView
  /** Required when `view` is `mine` — filters to rows claimed by this user. */
  claimedBy?: string | null
}

/**
 * The queue, oldest inbound first.
 *
 * Oldest first is deliberate and is the opposite of an inbox: the client who
 * has waited longest is the one the reply is most overdue to, and burying them
 * under this morning's mail is the failure this page exists to prevent.
 *
 * Resolved states are excluded — `replied` and `dismissed` rows are history,
 * kept so a rescan does not resurrect them. Actively snoozed rows are hidden
 * from the default views and only returned for `view: 'snoozed'`.
 */
export async function fetchEmailTriageQueue(
  options: FetchEmailTriageQueueOptions = {},
): Promise<EmailTriageRow[]> {
  const view = options.view ?? 'all'
  const nowIso = new Date().toISOString()
  const admin = getAdminClient()

  if (view === 'mine') {
    if (!options.claimedBy) return []
    const { data, error } = await admin
      .from('email_triage_threads')
      .select(ROW_COLUMNS)
      .in('status', [...OPEN_STATUSES])
      .eq('claimed_by', options.claimedBy)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .order('received_at', { ascending: true })
      .limit(200)
    if (error) throw error
    return (data ?? []) as unknown as EmailTriageRow[]
  }

  if (view === 'snoozed') {
    const { data, error } = await admin
      .from('email_triage_threads')
      .select(ROW_COLUMNS)
      .in('status', [...OPEN_STATUSES])
      .gt('snoozed_until', nowIso)
      .order('snoozed_until', { ascending: true })
      .limit(200)
    if (error) throw error
    return (data ?? []) as unknown as EmailTriageRow[]
  }

  if (view === 'follow_up') {
    const { data, error } = await admin
      .from('email_triage_threads')
      .select(ROW_COLUMNS)
      .not('follow_up_at', 'is', null)
      .lte('follow_up_at', nowIso)
      .in('status', ['replied', 'approved', 'dismissed', ...OPEN_STATUSES])
      .order('follow_up_at', { ascending: true })
      .limit(200)
    if (error) throw error
    return (data ?? []) as unknown as EmailTriageRow[]
  }

  let query = admin
    .from('email_triage_threads')
    .select(ROW_COLUMNS)
    .in('status', [...OPEN_STATUSES])
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order('received_at', { ascending: true })
    .limit(200)

  if (view === 'client' || view === 'lead' || view === 'contact' || view === 'possible_lead') {
    query = query.eq('classification', view)
  } else if (view === 'needs_draft') {
    query = query.in('status', ['needs_reply', 'failed'])
  } else if (view === 'drafted') {
    query = query.in('status', ['drafted', 'approved'])
  } else if (view === 'failed') {
    query = query.eq('status', 'failed')
  } else if (view === 'overdue') {
    // Firm reply SLA is 24h — filter in memory so we do not hardcode the
    // interval in SQL where DEFAULT_REPLY_SLA_HOURS could drift.
    const { data, error } = await query
    if (error) throw error
    const cutoff = Date.now() - 24 * 3_600_000
    return ((data ?? []) as unknown as EmailTriageRow[]).filter(
      row => Date.parse(row.received_at) < cutoff,
    )
  }

  const { data, error } = await query
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
    .select(
      'id, trigger, started_at, finished_at, threads_queued, drafts_generated, '
      + 'threads_listed, error',
    )
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

export async function fetchTriageArchiveNonClient(): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('email_triage_archive_non_client')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return (data as { email_triage_archive_non_client?: boolean } | null)
    ?.email_triage_archive_non_client !== false
}

/** Open rows whose follow-up reminder is due (for work graph / badges). */
export async function fetchDueEmailFollowUps(): Promise<EmailTriageRow[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await getAdminClient()
    .from('email_triage_threads')
    .select(ROW_COLUMNS)
    .not('follow_up_at', 'is', null)
    .lte('follow_up_at', nowIso)
    .order('follow_up_at', { ascending: true })
    .limit(100)
  if (error) throw error
  return (data ?? []) as unknown as EmailTriageRow[]
}
