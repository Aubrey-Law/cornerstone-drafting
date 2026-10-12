import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getMailboxIdentity } from '@/lib/email/gmailRead'
import { applyAndRecordMailboxSort, loadArchiveNonClientEnabled } from '@/lib/emailTriage/mailboxSort'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

// PATCH /api/admin/email-triage/[id] — draft edits, snooze, follow-up, note.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const existing = await fetchEmailTriageRow(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.draftSubject === 'string') patch.draft_subject = body.draftSubject
  if (typeof body.draftBody === 'string') patch.draft_body = body.draftBody
  if (typeof body.threadNote === 'string') patch.thread_note = body.threadNote
  if (typeof body.followUpNote === 'string') patch.follow_up_note = body.followUpNote

  const snoozedUntil = optionalTimestamp(body.snoozedUntil)
  if (snoozedUntil !== undefined) patch.snoozed_until = snoozedUntil

  const followUpAt = optionalTimestamp(body.followUpAt)
  if (followUpAt !== undefined) {
    patch.follow_up_at = followUpAt
    // Clearing the reminder also drops the note so a later follow-up starts clean.
    if (followUpAt === null && body.followUpNote === undefined) {
      patch.follow_up_note = null
    }
  }

  // Claim / release for multi-staff: `true` claims for the caller, `null` releases.
  if (body.claimedBy === null) {
    patch.claimed_by = null
  } else if (body.claimedBy === true) {
    patch.claimed_by = auth.userId ?? null
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await getAdminClient()
    .from('email_triage_threads')
    .update(patch)
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Mirror snooze / follow-up into Gmail when those fields changed.
  const snoozeChanged = snoozedUntil !== undefined
  const followUpChanged = followUpAt !== undefined
  if (snoozeChanged || followUpChanged) {
    try {
      const identity = await getMailboxIdentity(auth.userId ?? null)
      const archiveEnabled = await loadArchiveNonClientEnabled().catch(() => true)
      const now = Date.now()
      const activelySnoozed = Boolean(row.snoozed_until && Date.parse(row.snoozed_until) > now)
      const followUpDue = Boolean(row.follow_up_at && Date.parse(row.follow_up_at) <= now)

      if (activelySnoozed) {
        await applyAndRecordMailboxSort({
          token: identity.token,
          threadId: row.gmail_thread_id,
          kind: 'snoozed',
          classification: row.classification,
          archiveEnabled,
          triageRowId: row.id,
        })
      } else if (followUpDue) {
        await applyAndRecordMailboxSort({
          token: identity.token,
          threadId: row.gmail_thread_id,
          kind: 'follow_up_due',
          classification: row.classification,
          archiveEnabled,
          triageRowId: row.id,
        })
      } else if (snoozeChanged && snoozedUntil === null) {
        // Cleared snooze while still open — restore needs-reply filing.
        if (['needs_reply', 'drafting', 'drafted', 'failed', 'approved'].includes(row.status)) {
          await applyAndRecordMailboxSort({
            token: identity.token,
            threadId: row.gmail_thread_id,
            kind: 'needs_reply',
            classification: row.classification,
            archiveEnabled,
            triageRowId: row.id,
          })
        }
      }
    } catch {
      // Row is saved; Gmail mirror is best-effort.
    }
  }

  return NextResponse.json({ row })
}
