import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { htmlToText } from '@/lib/email/gmailRead'
import { isMissingTableError } from '@/lib/emailTriage/fileInbound'
import { inboundEmailItem, OPEN_TRIAGE_STATUSES, type InboundEmailRow } from '@/lib/comms/inboundEmail'
import { isUuid } from '@/lib/queries/tasks'
import type { CommunicationItem } from '@/lib/comms/thread'

/**
 * A record's email, both directions: the firm's own sends from `email_log`,
 * and the inbound Gmail the triage scan filed on the record
 * (`email_inbound_messages`, snippets only; the body is read live through
 * `/api/admin/comms/email-inbound/[id]`). Opening the history marks the
 * inbound mail read, as opening the portal thread does.
 */

const RECORD_COLUMN = { lead: 'lead_id', matter: 'matter_id', contact: 'contact_id' } as const
const INBOUND_COLUMN = { lead: 'client_intake_id', matter: 'matter_id', contact: 'contact_id' } as const

type InboundHistoryRow = InboundEmailRow & { read_by_staff_at: string | null }

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const url = new URL(req.url)
  const type = url.searchParams.get('type') as keyof typeof RECORD_COLUMN | null
  const id = url.searchParams.get('id')
  if (!id || !isUuid(id) || !type || !(type in RECORD_COLUMN)) {
    return Response.json({ error: 'A valid record is required' }, { status: 400 })
  }
  const admin = getAdminClient()
  const { data, error } = await admin.from('email_log')
    .select('id, subject, html, status, to_email, sent_at, created_at').eq(RECORD_COLUMN[type], id).order('created_at', { ascending: true })
  if (error) return Response.json({ error: 'Email history is unavailable' }, { status: 500 })
  const outbound: CommunicationItem[] = (data ?? []).map(row => ({
    id: row.id, channel: 'email', direction: 'outbound', body: row.html ? htmlToText(row.html) : 'Message body unavailable.',
    meta: `${row.subject || '(No subject)'} · ${row.status || 'Status unavailable'}`,
    sender: `To ${row.to_email}`, created_at: row.sent_at ?? row.created_at,
  }))

  // Inbound is additive: a missing table (deploy order) or a failed read
  // leaves the outbound history exactly as it was.
  const inboundResult = await admin.from('email_inbound_messages')
    .select('id, gmail_thread_id, sender_email, sender_name, subject, snippet, received_at, read_by_staff_at')
    .eq(INBOUND_COLUMN[type], id).order('received_at', { ascending: true }).limit(200)
  if (inboundResult.error) {
    if (!isMissingTableError(inboundResult.error)) {
      console.error('[comms] inbound email history unavailable', { type, id, error: inboundResult.error.message })
    }
    return Response.json(outbound)
  }
  const inboundRows = (inboundResult.data ?? []) as InboundHistoryRow[]
  if (inboundRows.length === 0) return Response.json(outbound)

  const threadIds = Array.from(new Set(inboundRows.map(row => row.gmail_thread_id)))
  const { data: triageRows } = await admin.from('email_triage_threads')
    .select('id, gmail_thread_id, status')
    .in('gmail_thread_id', threadIds)
    .in('status', [...OPEN_TRIAGE_STATUSES])
  const openTriageIdByThread = new Map<string, string>()
  for (const row of (triageRows ?? []) as { id: string; gmail_thread_id: string }[]) {
    openTriageIdByThread.set(row.gmail_thread_id, row.id)
  }

  const unread = inboundRows.filter(row => !row.read_by_staff_at).map(row => row.id)
  if (unread.length > 0) {
    // Best effort: the history is still served when the mark fails.
    await admin.from('email_inbound_messages')
      .update({ read_by_staff_at: new Date().toISOString() })
      .in('id', unread)
      .is('read_by_staff_at', null)
  }

  return Response.json([...outbound, ...inboundRows.map(row => inboundEmailItem(row, openTriageIdByThread))])
}
