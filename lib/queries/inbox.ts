import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  mergeCommunicationItems,
  type CommunicationItem,
  type InboxThread,
} from '@/lib/comms/thread'
import type { LinkedCallRow } from '@/components/calls/types'

const INBOX_CALL_COLUMNS =
  'id, direction, status, participant_number, started_at, duration_seconds, recording_url, voicemail_url, summary, firm_user_email, matter_id, lead_id, contact_id, triage_dismissed_at' as const

export interface FetchInboxThreadsOptions {
  limit?: number
  /** Return threads with last_message_at strictly before this ISO timestamp. */
  cursor?: string | null
  includeArchived?: boolean
}

export async function fetchInboxThreads({
  limit = 50,
  cursor = null,
  includeArchived = false,
}: FetchInboxThreadsOptions = {}): Promise<InboxThread[]> {
  const admin = getAdminClient()
  let query = admin
    .from('v_communication_threads')
    .select('*')
    .order('last_message_at', { ascending: false })
    .limit(limit)
  if (!includeArchived) query = query.is('archived_at', null)
  if (cursor) query = query.lt('last_message_at', cursor)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as InboxThread[]
}

/**
 * Threads with an unanswered client message, not snoozed or archived.
 *
 * Contact threads are excluded on purpose: this count drives the rail badge
 * and the pre-engagement SLA, both of which measure responsiveness to clients
 * and leads. An unanswered text from a referral partner or vendor shouldn't
 * make the firm look behind on client work.
 */
export async function fetchInboxNeedsReplyCount(): Promise<number> {
  const admin = getAdminClient()
  const { count, error } = await admin
    .from('v_communication_threads')
    .select('thread_key', { count: 'exact', head: true })
    .not('waiting_since', 'is', null)
    .is('archived_at', null)
    .neq('record_type', 'contact')
    .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Calls that still need a human to identify their record or dismiss them. */
export async function fetchUnlinkedInboxCalls(limit = 200): Promise<LinkedCallRow[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('calls')
    .select(INBOX_CALL_COLUMNS)
    .is('matter_id', null)
    .is('lead_id', null)
    .is('contact_id', null)
    .is('triage_dismissed_at', null)
    .order('started_at', { ascending: false })
    .limit(Math.min(Math.max(1, Math.trunc(limit)), 200))

  if (error) throw new Error(error.message)
  return (data ?? []) as LinkedCallRow[]
}

export interface ParsedThreadKey {
  recordType: 'matter' | 'lead' | 'contact'
  recordId: string
}

const THREAD_KEY_PATTERN = /^(matter|lead|contact):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export function parseThreadKey(key: string): ParsedThreadKey | null {
  const match = THREAD_KEY_PATTERN.exec(key)
  if (!match) return null
  return { recordType: match[1] as ParsedThreadKey['recordType'], recordId: match[2] }
}

/** Full merged timeline for one record, across all four sources. */
export async function fetchThreadItems(key: ParsedThreadKey): Promise<CommunicationItem[]> {
  const admin = getAdminClient()
  const items: CommunicationItem[][] = []

  const smsQuery = admin
    .from('sms_messages')
    .select('id, direction, body, status, recipient_name, actor_name, created_at')
    .order('created_at', { ascending: true })
    .limit(500)
  const callsQuery = admin
    .from('calls')
    .select('id, direction, status, participant_number, summary, duration_seconds, started_at, firm_user_email, recording_url, voicemail_url')
    .order('started_at', { ascending: true })
    .limit(200)

  if (key.recordType === 'matter') {
    const [portal, sms, calls, emails] = await Promise.all([
      admin
        .from('messages')
        .select('id, body, sender_role, created_at')
        .eq('matter_id', key.recordId)
        .order('created_at', { ascending: true })
        .limit(500),
      smsQuery.eq('matter_id', key.recordId),
      callsQuery.eq('matter_id', key.recordId),
      admin
        .from('email_log')
        .select('id, subject, actual_to, status, created_at')
        .eq('matter_id', key.recordId)
        .neq('status', 'error')
        .order('created_at', { ascending: true })
        .limit(200),
    ])
    for (const res of [portal, sms, calls, emails]) {
      if (res.error) throw new Error(res.error.message)
    }
    items.push(
      (portal.data ?? []).map(row => ({
        id: row.id as string,
        channel: 'portal' as const,
        direction: row.sender_role === 'client' ? 'inbound' as const : 'outbound' as const,
        body: (row.body as string) ?? '',
        sender: row.sender_role === 'client' ? null : 'Firm',
        created_at: row.created_at as string,
      })),
      smsRows(sms.data ?? []),
      callRows(calls.data ?? []),
      emailRows(emails.data ?? []),
    )
  } else {
    // Leads and contacts have no portal thread; everything else scopes off the
    // same column.
    const column = key.recordType === 'contact' ? 'contact_id' : 'lead_id'
    const [sms, calls, emails] = await Promise.all([
      smsQuery.eq(column, key.recordId),
      callsQuery.eq(column, key.recordId),
      admin
        .from('email_log')
        .select('id, subject, actual_to, status, created_at')
        .eq(column, key.recordId)
        .neq('status', 'error')
        .order('created_at', { ascending: true })
        .limit(200),
    ])
    for (const res of [sms, calls, emails]) {
      if (res.error) throw new Error(res.error.message)
    }
    items.push(smsRows(sms.data ?? []), callRows(calls.data ?? []), emailRows(emails.data ?? []))
  }

  return mergeCommunicationItems(...items)
}

interface SmsRow {
  id: string
  direction: string
  body: string
  status: string | null
  recipient_name: string | null
  actor_name: string | null
  created_at: string
}

function smsRows(rows: unknown[]): CommunicationItem[] {
  return (rows as SmsRow[]).map(row => ({
    id: row.id,
    channel: 'sms' as const,
    direction: row.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
    body: row.body ?? '',
    meta: row.status ?? null,
    sender: row.direction === 'inbound' ? row.recipient_name : row.actor_name ?? 'Firm',
    created_at: row.created_at,
  }))
}

interface EmailRow {
  id: string
  subject: string | null
  actual_to: string | null
  created_at: string
}

/** email_log is outbound-only today; inbound email arrives with a sync. */
function emailRows(rows: unknown[]): CommunicationItem[] {
  return (rows as EmailRow[]).map(row => ({
    id: row.id,
    channel: 'email' as const,
    direction: 'outbound' as const,
    body: row.subject || 'Email sent',
    meta: row.actual_to ?? null,
    created_at: row.created_at,
  }))
}

interface CallRow {
  id: string
  direction: string
  status: string
  summary: string | null
  duration_seconds: number | null
  started_at: string
  firm_user_email: string | null
  participant_number: string
  recording_url: string | null
  voicemail_url: string | null
}

function callRows(rows: unknown[]): CommunicationItem[] {
  return (rows as CallRow[]).map(row => ({
    id: row.id,
    channel: 'call' as const,
    direction: row.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
    body: row.summary?.trim() || `${row.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`,
    meta: [row.status, row.duration_seconds != null ? `${row.duration_seconds}s` : null]
      .filter(Boolean)
      .join(' · ') || null,
    sender: row.direction === 'outbound' ? row.firm_user_email : null,
    created_at: row.started_at,
    call: {
      participant_number: row.participant_number,
      recording_url: row.recording_url,
      voicemail_url: row.voicemail_url,
      needs_response:
        row.direction === 'inbound' &&
        (Boolean(row.voicemail_url) || ['missed', 'no-answer', 'voicemail'].includes(row.status)),
    },
  }))
}
