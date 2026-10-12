import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createLead } from '@/lib/leads/createLead'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'
import { getMailboxIdentity } from '@/lib/email/gmailRead'
import { applyAndRecordMailboxSort, loadArchiveNonClientEnabled } from '@/lib/emailTriage/mailboxSort'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/email-triage/[id]/create-lead — turn a possible_lead thread
 * into a real lead and link the triage row, reusing the standard createLead path.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (row.classification !== 'possible_lead') {
    return NextResponse.json(
      { error: 'Only possible-lead threads can create a lead from Mail Desk' },
      { status: 400 },
    )
  }
  if (row.client_intake_id) {
    return NextResponse.json(
      { error: 'This thread is already linked to a lead', leadId: row.client_intake_id },
      { status: 409 },
    )
  }

  const body = await req.json().catch(() => ({})) as {
    clientName?: unknown
    clientEmail?: unknown
    practiceArea?: unknown
  }

  const clientEmail = (
    typeof body.clientEmail === 'string' && body.clientEmail.trim()
      ? body.clientEmail.trim()
      : row.sender_email
  ).toLowerCase()
  const clientName = (
    typeof body.clientName === 'string' && body.clientName.trim()
      ? body.clientName.trim()
      : (row.sender_name?.trim() || clientEmail.split('@')[0] || clientEmail)
  )

  let lead
  try {
    lead = await createLead({
      clientName,
      clientEmail,
      practiceArea: typeof body.practiceArea === 'string' ? body.practiceArea : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create lead'
    return NextResponse.json(
      { error: message },
      { status: message === 'Invalid practice area' ? 400 : 500 },
    )
  }

  const now = new Date().toISOString()
  const { error } = await getAdminClient()
    .from('email_triage_threads')
    .update({
      client_intake_id: lead.leadId,
      classification: 'lead',
      classification_reason: 'Created from Mail Desk',
      updated_at: now,
    })
    .eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message, leadId: lead.leadId }, { status: 500 })
  }

  // Best-effort: refile under Cornerstone/Lead now that it is a real lead.
  try {
    const identity = await getMailboxIdentity(auth.userId ?? null)
    const archiveEnabled = await loadArchiveNonClientEnabled().catch(() => true)
    await applyAndRecordMailboxSort({
      token: identity.token,
      threadId: row.gmail_thread_id,
      kind: 'needs_reply',
      classification: 'lead',
      archiveEnabled,
      triageRowId: id,
    })
  } catch {
    // Lead and link are saved.
  }

  revalidateSidebarCounts()
  const updated = await fetchEmailTriageRow(id)
  return NextResponse.json({
    ok: true,
    leadId: lead.leadId,
    intakeUrl: lead.intakeUrl,
    row: updated,
  })
}
