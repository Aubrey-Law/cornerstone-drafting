import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { deleteGmailDraft } from '@/lib/email/gmailDraft'
import { removeTriageLabels } from '@/lib/email/gmailLabels'
import { getMailboxIdentity } from '@/lib/email/gmailRead'
import { emailDomain } from '@/lib/emailTriage/classifySender'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

type Scope = 'thread' | 'sender' | 'domain'

// POST /api/admin/email-triage/[id]/dismiss — clear one thread, or stop hearing
// from this sender or domain at all.
//
// The wider scopes write an ignore rule, which is how the noise filter actually
// gets tuned: a constant in the source would need a deploy to teach.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { scope?: unknown; reason?: unknown }
  const scope: Scope = body.scope === 'sender' || body.scope === 'domain' ? body.scope : 'thread'
  const reason = typeof body.reason === 'string' ? body.reason : null

  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = getAdminClient()
  const now = new Date().toISOString()

  if (scope !== 'thread') {
    const value = scope === 'domain' ? emailDomain(row.sender_email) : row.sender_email
    const { error } = await admin
      .from('email_triage_ignore_rules')
      .insert({
        kind: scope === 'domain' ? 'domain' : 'address',
        value,
        note: reason ?? `dismissed from triage on ${now.slice(0, 10)}`,
        created_by: auth.userId ?? null,
      })
    // A duplicate rule means it is already ignored, which is the outcome asked
    // for; anything else is a real failure.
    if (error && !/duplicate key|unique constraint/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Clear everything else already queued from them, or the attorney has to
    // dismiss the same vendor once per thread.
    const column = scope === 'domain' ? 'sender_domain' : 'sender_email'
    await admin
      .from('email_triage_threads')
      .update({ status: 'dismissed', dismissed_at: now, dismissed_reason: reason, updated_at: now })
      .eq(column, value)
      .in('status', ['needs_reply', 'drafting', 'drafted', 'failed'])
  }

  const { error } = await admin
    .from('email_triage_threads')
    .update({ status: 'dismissed', dismissed_at: now, dismissed_reason: reason, updated_at: now })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const gmailCleanup = scope === 'thread'
    ? null
    : await cleanUpInGmail(
      admin,
      scope === 'domain'
        ? { column: 'sender_domain', value: emailDomain(row.sender_email) }
        : { column: 'sender_email', value: row.sender_email },
      auth.userId ?? null,
    )

  return NextResponse.json({ ok: true, scope, gmailCleanup })
}

/**
 * "Never this sender" and "Never this domain" also undo what triage did in
 * Gmail for them: the Client / Lead label comes off their threads and any
 * reply draft Cornerstone put there is deleted, so nothing is left filed or
 * half-answered.
 *
 * Every row from the sender or domain counts, not only the open ones — an approved row
 * is exactly the one that carries a label and a draft. Best effort: the
 * dismissal has already been saved, so a Gmail failure is reported back
 * rather than turned into a failed request.
 */
async function cleanUpInGmail(
  admin: ReturnType<typeof getAdminClient>,
  match: { column: 'sender_email' | 'sender_domain'; value: string },
  userId: string | null,
): Promise<{ labelsRemoved: number; draftsDeleted: number; error: string | null }> {
  const result = { labelsRemoved: 0, draftsDeleted: 0, error: null as string | null }
  try {
    const { data, error } = await admin
      .from('email_triage_threads')
      .select('id, gmail_thread_id, gmail_draft_id')
      .eq(match.column, match.value)
    if (error) throw error
    const rows = (data ?? []) as { id: string; gmail_thread_id: string; gmail_draft_id: string | null }[]
    if (rows.length === 0) return result

    const identity = await getMailboxIdentity(userId)
    result.labelsRemoved = await removeTriageLabels({
      token: identity.token,
      threadIds: Array.from(new Set(rows.map(r => r.gmail_thread_id))),
    })

    for (const r of rows) {
      if (!r.gmail_draft_id) continue
      // Already sent or deleted in Gmail reads as success inside deleteGmailDraft.
      await deleteGmailDraft(r.gmail_draft_id, userId)
      await admin
        .from('email_triage_threads')
        .update({ gmail_draft_id: null, gmail_draft_message_id: null, updated_at: new Date().toISOString() })
        .eq('id', r.id)
      result.draftsDeleted += 1
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  return result
}
