import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { htmlToText } from '@/lib/email/gmailRead'
import { isUuid } from '@/lib/queries/tasks'

/** Outbound delivery records only; inbound mailbox history is not stored here. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const id = url.searchParams.get('id')
  if (!id || !isUuid(id) || !['lead', 'matter', 'contact'].includes(type ?? '')) {
    return Response.json({ error: 'A valid record is required' }, { status: 400 })
  }
  const column = type === 'lead' ? 'lead_id' : type === 'matter' ? 'matter_id' : 'contact_id'
  const { data, error } = await getAdminClient().from('email_log')
    .select('id, subject, html, status, to_email, sent_at, created_at').eq(column, id).order('created_at', { ascending: true })
  if (error) return Response.json({ error: 'Email history is unavailable' }, { status: 500 })
  return Response.json((data ?? []).map(row => ({
    id: row.id, channel: 'email', direction: 'outbound', body: row.html ? htmlToText(row.html) : 'Message body unavailable.',
    meta: `${row.subject || '(No subject)'} · ${row.status || 'Status unavailable'}`,
    sender: `To ${row.to_email}`, created_at: row.sent_at ?? row.created_at,
  })))
}
