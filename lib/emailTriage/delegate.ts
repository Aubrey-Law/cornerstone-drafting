import { getAdminClient } from '@/lib/supabaseAdmin'
import type { TriageClassification } from '@/lib/queries/emailTriage'

/**
 * Where a freshly drafted triage reply meets the delegation dial.
 *
 * The triage page is the "Propose" surface for this action: a draft sitting
 * there is the proposal, and the attorney's "Send reply" is the click. So the
 * dial is consulted only to go beyond that. "Observe" records what would have
 * been sent; "Act and report" sends through the shared registry action and
 * lists it in the digest and on Today. Nothing here changes what the page
 * does with a draft the dial left alone.
 */

export const TRIAGE_REPLY_ACTION_KEY = 'email.triage.reply.send'

/**
 * Senders the dial may answer unattended. A reply to someone the firm has a
 * record for is bounded by that record; a reply to a stranger or a contact is
 * not, so those always wait on the triage page whatever the dial says.
 */
export const DELEGATED_TRIAGE_CLASSIFICATIONS: readonly TriageClassification[] = ['client', 'lead']

export type TriageDelegationOutcome = 'skipped' | 'observed' | 'sent' | 'failed'

export interface TriageDelegationRow {
  id: string
  gmail_message_id: string
  classification: TriageClassification
  sender_email: string
  sender_name: string | null
  subject: string | null
  matter_id: string | null
  client_intake_id: string | null
}

export function triageReplySummary(row: Pick<TriageDelegationRow, 'sender_email' | 'sender_name' | 'subject'>): string {
  const who = row.sender_name?.trim() || row.sender_email
  const about = row.subject?.trim()
  return about ? `Reply to ${who} re: ${about}` : `Reply to ${who}`
}

export async function delegateTriageReply(args: {
  row: TriageDelegationRow
  /** The staff user the send runs as; the mailbox owner for a cron run. */
  actorId: string | null
}): Promise<TriageDelegationOutcome> {
  const { row, actorId } = args
  if (!actorId) return 'skipped'
  if (!DELEGATED_TRIAGE_CLASSIFICATIONS.includes(row.classification)) return 'skipped'

  // Loaded here rather than at module scope so the scan can be imported in
  // tests without the server-only action service.
  const { resolveActionAutonomy } = await import('@/lib/actions/delegation')
  const autonomy = await resolveActionAutonomy(TRIAGE_REPLY_ACTION_KEY, 'external_write')
  if (autonomy === 'propose') return 'skipped'

  try {
    const { createActionProposal } = await import('@/lib/actions/server')
    const created = await createActionProposal({
      actionKey: TRIAGE_REPLY_ACTION_KEY,
      displaySummary: triageReplySummary(row),
      referencePayload: { triageId: row.id },
      recordType: row.matter_id ? 'matter' : row.client_intake_id ? 'lead' : 'firm',
      recordId: row.matter_id ?? row.client_intake_id ?? undefined,
      source: 'automation',
      // One proposal per inbound message: a new message from the sender
      // resets the row and redrafts, which is a new decision.
      idempotencyKey: `triage-reply:${row.id}:${row.gmail_message_id}`,
      applyAutonomy: true,
    }, { id: actorId })
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution?.status === 'succeeded') return 'sent'
    return created.duplicate ? 'skipped' : 'failed'
  } catch (error) {
    // The draft stays on the page with the reason attached. The send module
    // writes its own `Not sent:` note for Gmail failures; this covers the
    // refusals and anything upstream of the send.
    const detail = error instanceof Error ? error.message : String(error)
    await getAdminClient()
      .from('email_triage_threads')
      .update({ draft_error: `Not sent: ${detail}`, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('draft_error', null)
    console.error('triage reply delegation failed', { triageId: row.id, cause: detail })
    return 'failed'
  }
}
