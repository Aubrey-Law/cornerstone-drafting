import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
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

  return NextResponse.json({ ok: true, scope })
}
