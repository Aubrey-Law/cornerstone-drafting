'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getAdminClient, ADMIN_EMAIL } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { appUrl } from '@/lib/urls'

export interface RequestUnlockResult {
  requestedAt: string
}

export async function requestIntakeUnlock(note?: string, intakeId?: string): Promise<RequestUnlockResult> {
  const sb = await createServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // limit(1) rather than maybeSingle(): a user may legitimately have more than
  // one intake row (re-invite, second engagement), and maybeSingle() errors in
  // that case, which would make the unlock request permanently unavailable.
  // Ordering matches findClientIntakeForUser.
  // A named questionnaire (one of several this person holds) is used when the
  // caller owns it; the ownership predicate below still applies either way.
  let lookup = sb
    .from('client_intake')
    .select('id, status, first_name, last_name, email')
    .or(`user_id.eq.${user.id},client_user_id.eq.${user.id}`)
  if (intakeId && /^[0-9a-f-]{36}$/i.test(intakeId)) lookup = lookup.eq('id', intakeId)
  const { data: intakeRows, error: readError } = await lookup
    .order('created_at', { ascending: true })
    .limit(1)
  if (readError) throw new Error(readError.message)
  const intake = intakeRows?.[0]
  if (!intake) throw new Error('We could not find your questionnaire.')
  if (intake.status !== 'submitted' && intake.status !== 'approved') {
    throw new Error('Your questionnaire is already open for editing.')
  }

  const requestedAt = new Date().toISOString()
  const trimmedNote = typeof note === 'string' && note.trim() ? note.trim() : null

  const admin = getAdminClient()
  const { error: updateError } = await admin
    .from('client_intake')
    .update({ unlock_requested_at: requestedAt, unlock_request_note: trimmedNote })
    .eq('id', intake.id)
  if (updateError) throw new Error(updateError.message)

  let { data: matter } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('client_intake_id', intake.id)
    .maybeSingle()
  if (!matter) {
    // A linked questionnaire (e.g. a student's College Prep) has no matter of
    // its own; route the request to the matter it was added to.
    const { data: link } = await admin.from('matter_linked_intakes' as never).select('matter_id').eq('client_intake_id', intake.id).maybeSingle()
    const linkedMatterId = (link as { matter_id?: string } | null)?.matter_id
    if (linkedMatterId) {
      ;({ data: matter } = await admin.from('matters').select('id, relationship_status').eq('id', linkedMatterId).maybeSingle())
    }
  }
  const adminLink = matter?.id && matter.relationship_status === 'hired'
    ? appUrl(`/admin/matters/${matter.id}?tab=communications&channel=portal`)
    : appUrl(`/admin/crm/opportunities/${intake.id}`)

  const clientName =
    [intake.first_name, intake.last_name].filter(Boolean).join(' ') || 'A client'

  void sendEmail({
    category: 'message_alert',
    to: ADMIN_EMAIL,
    replyTo: (intake.email as string | null) ?? undefined,
    subject: `Intake change request: ${clientName}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">Client requested changes to a submitted intake</h2>
      <p><strong>${clientName}</strong> asked to reopen their submitted questionnaire.${
        trimmedNote ? `</p><p style="white-space:pre-wrap">${trimmedNote}</p>` : '</p>'
      }
      <p><a href="${adminLink}" style="color:#1a6b72">Open matter →</a></p>
    </div>`,
  }).catch((err) => console.error('[requestIntakeUnlock] notify error:', err))

  revalidatePath('/intake')
  return { requestedAt }
}
