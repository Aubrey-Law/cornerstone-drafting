import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getMailboxIdentity } from '@/lib/email/gmailRead'
import { resolveEmailTriageLink } from '@/lib/emailTriage/linkRecord'
import { applyAndRecordMailboxSort, loadArchiveNonClientEnabled } from '@/lib/emailTriage/mailboxSort'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : null
}

/**
 * POST /api/admin/email-triage/[id]/link
 * Body: { leadId?, matterId? } or { unlink: true }
 *
 * Attach (or clear) a CRM record on a Mail Desk thread. Sets
 * `record_linked_manually` so the next scan keeps the link.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const unlink = body.unlink === true
  const leadId = uuidOrNull(body.leadId)
  const matterId = uuidOrNull(body.matterId)

  const admin = getAdminClient()
  let matterIntakeId: string | null = null
  let leadMatterId: string | null = null

  if (!unlink && matterId) {
    const { data: matter, error } = await admin
      .from('matters')
      .select('id, client_intake_id')
      .eq('id', matterId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    matterIntakeId = (matter.client_intake_id as string | null) ?? null
  } else if (!unlink && leadId) {
    const { data: lead, error } = await admin
      .from('client_intake')
      .select('id, matter_id')
      .eq('id', leadId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    leadMatterId = (lead.matter_id as string | null) ?? null
  }

  const resolved = resolveEmailTriageLink({
    unlink,
    leadId,
    matterId,
    matterIntakeId,
    leadMatterId,
  })
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from('email_triage_threads')
    .update({
      classification: resolved.classification,
      classification_reason: resolved.classification_reason,
      client_intake_id: resolved.client_intake_id,
      matter_id: resolved.matter_id,
      contact_id: resolved.contact_id,
      record_linked_manually: resolved.record_linked_manually,
      updated_at: now,
    })
    .eq('id', id)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Best-effort: refile under the relationship label now that the link changed.
  try {
    const identity = await getMailboxIdentity(auth.userId ?? null)
    const archiveEnabled = await loadArchiveNonClientEnabled().catch(() => true)
    const open = ['needs_reply', 'drafting', 'drafted', 'failed', 'approved'].includes(row.status)
    if (open) {
      await applyAndRecordMailboxSort({
        token: identity.token,
        threadId: row.gmail_thread_id,
        kind: 'needs_reply',
        classification: resolved.classification,
        archiveEnabled,
        triageRowId: id,
      })
    }
  } catch {
    // Link is saved.
  }

  revalidateSidebarCounts()
  const updated = await fetchEmailTriageRow(id)
  return NextResponse.json({ ok: true, row: updated })
}
