import type { SupabaseClient } from '@supabase/supabase-js'
import type { EsignProviderName } from '@/lib/esign/types'
import type { EngagementInput } from './types'
import { verifyRevisionApproval } from './approval'

type Json = Record<string, unknown> | unknown[]
type AgreementRow = Record<string, unknown> & {
  active_revision_id: string | null
}

export interface AgreementDraftInput {
  matterId: string
  preparedBy?: string | null
  inputSnapshot: EngagementInput
  renderSnapshot?: Json
  renderSha256: string
  masterVersion: string
  htmlR2Key?: string | null
  pdfR2Key?: string | null
}

async function one<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Engagement persistence returned no row')
  return data
}

export async function createAgreementDraft(client: SupabaseClient, input: AgreementDraftInput) {
  const agreement = await one<{ id: string }>(client.from('engagement_agreements').insert({
    matter_id: input.matterId,
    lead_id: null,
    prepared_by: input.preparedBy ?? null,
  }).select().single())
  const agreementId = agreement.id
  const recipients = [
    { agreement_id: agreementId, recipient_order: 1, role: 'primary', ...input.inputSnapshot.primary, email: input.inputSnapshot.primary.email.toLowerCase() },
    ...(input.inputSnapshot.spouse
      ? [{ agreement_id: agreementId, recipient_order: 2, role: 'spouse', ...input.inputSnapshot.spouse, email: input.inputSnapshot.spouse.email.toLowerCase() }]
      : []),
  ]
  try {
    const { error: recipientError } = await client.from('engagement_agreement_recipients').insert(recipients)
    if (recipientError) throw new Error(recipientError.message)
    return await createAgreementRevision(client, agreementId, input)
  } catch (error) {
    // An agreement with no revision cannot open in the workspace, yet it still
    // counts as the record's open draft — the lead page offered an "Open" link
    // to a 404 and every retry stacked another one. Nothing has been sent, so
    // the half-made row goes (recipients and revisions cascade).
    await client.from('engagement_agreements').delete().eq('id', agreementId)
    throw error
  }
}

export async function createAgreementRevision(
  client: SupabaseClient,
  agreementId: string,
  input: Omit<AgreementDraftInput, 'matterId' | 'preparedBy'>,
) {
  const revision = await one<{ id: string }>(client.rpc('create_engagement_agreement_revision', {
    p_agreement_id: agreementId,
    p_input_snapshot: input.inputSnapshot,
    p_render_snapshot: input.renderSnapshot ?? {},
    p_render_sha256: input.renderSha256,
    p_master_version: input.masterVersion,
    p_html_r2_key: input.htmlR2Key ?? null,
    p_pdf_r2_key: input.pdfR2Key ?? null,
  }).single())
  return { agreementId, revision }
}

export async function getAgreement(client: SupabaseClient, agreementId: string) {
  const agreement = await one<AgreementRow>(client
    .from('engagement_agreements')
    .select('*')
    .eq('id', agreementId)
    .single())

  const activeRevision = agreement.active_revision_id
    ? await one(client
      .from('engagement_agreement_revisions')
      .select('*')
      .eq('agreement_id', agreementId)
      .eq('id', agreement.active_revision_id)
      .single())
    : null

  const { data: recipients, error: recipientsError } = await client
    .from('engagement_agreement_recipients')
    .select('*')
    .eq('agreement_id', agreementId)
    .order('recipient_order', { ascending: true })
  if (recipientsError) throw new Error(recipientsError.message)

  return {
    ...agreement,
    active_revision: activeRevision,
    recipients: recipients ?? [],
  }
}

export async function claimAgreementSend(client: SupabaseClient, input: {
  agreementId: string
  revisionId: string
  renderSha256: string
  approvalToken: string
  sentBy: string
}) {
  const approval = verifyRevisionApproval(input.approvalToken, {
    agreementId: input.agreementId,
    revisionId: input.revisionId,
    sha256: input.renderSha256,
  })
  if (!approval.ok) throw new Error(approval.error)
  const { data, error } = await client.rpc('claim_engagement_agreement_send', {
    p_agreement_id: input.agreementId,
    p_revision_id: input.revisionId,
    p_render_sha256: input.renderSha256,
    p_approval_nonce: approval.claims.nonce,
    p_sent_by: input.sentBy,
  })
  if (error) throw new Error(error.message)
  return { claimed: Array.isArray(data) && data.length === 1 }
}

export async function markAgreementReady(client: SupabaseClient, input: {
  agreementId: string; revisionId: string; renderSha256: string
}) {
  return one(client.rpc('mark_engagement_agreement_ready', {
    p_agreement_id: input.agreementId,
    p_revision_id: input.revisionId,
    p_render_sha256: input.renderSha256,
  }).single())
}

/**
 * Record the provider's request id against a sending agreement.
 *
 * Both the generic and the Firma-specific column are written while Firma is a
 * provider: the generic one is what new code reads, and the legacy one keeps
 * `claim_engagement_agreement_resume` and any un-migrated row working through
 * the compatibility window. They are dropped together, after a data audit.
 */
export async function recordExternalRequest(
  client: SupabaseClient,
  agreementId: string,
  externalRequestId: string,
  provider: EsignProviderName = 'firma',
) {
  return one(client.from('engagement_agreements').update({
    provider,
    external_request_id: externalRequestId,
    ...(provider === 'firma' ? { firma_request_id: externalRequestId } : {}),
  }).eq('id', agreementId).eq('status', 'sending').select().single())
}

/**
 * Release a send claim, recording why it failed.
 *
 * The reason used to go to the HTTP response and the server logs and nowhere
 * durable, so a failed send left a row saying `failed` and nothing saying what
 * happened. Diagnosing the first three native sends meant reading an error
 * string off someone's screen.
 *
 * `provider_sync_error` already carries exactly this for the reconcile and
 * webhook paths (lib/esign/reconcile.ts, app/api/webhooks/esign/route.ts), and
 * lib/engagement/postSend.ts already surfaces it. The send path was the one
 * place that did not take part.
 */
export async function releaseAgreementClaim(client: SupabaseClient, agreementId: string, error: string) {
  const now = new Date().toISOString()
  const { error: updateError } = await client.from('engagement_agreements').update({
    status: 'failed',
    send_lease_id: null,
    send_lease_expires_at: null,
    // Bounded: a provider can return a very long body, and this is read by a
    // person trying to find out what broke, not by a parser.
    provider_sync_error: error.slice(0, 2000),
    provider_sync_error_at: now,
    updated_at: now,
  }).eq('id', agreementId).eq('status', 'sending')
  if (updateError) throw new Error(`${error}: ${updateError.message}`)
}

export async function markAgreementSent(client: SupabaseClient, agreementId: string) {
  // Clear the previous failure. A send that succeeded on a retry must not keep
  // showing the error from the attempt before it — the same way reconcile.ts
  // clears these on a successful sync.
  return one(client.from('engagement_agreements').update({
    status: 'sent',
    sent_at: new Date().toISOString(),
    provider_sync_error: null,
    provider_sync_error_at: null,
  }).eq('id', agreementId).eq('status', 'sending').select().single())
}

export async function claimAgreementResume(client: SupabaseClient, input: { agreementId: string; requestId: string; sentBy: string }) {
  const { data, error } = await client.rpc('claim_engagement_agreement_resume', {
    p_agreement_id: input.agreementId, p_firma_request_id: input.requestId, p_sent_by: input.sentBy,
  })
  if (error) throw new Error(error.message)
  return { claimed: Array.isArray(data) && data.length === 1 }
}

export async function recordExternalRecipients(
  client: SupabaseClient,
  agreementId: string,
  recipients: Array<{ key: string; externalId: string }>,
  provider: EsignProviderName = 'firma',
) {
  for (const recipient of recipients) {
    const { data, error } = await client.from('engagement_agreement_recipients')
      .update({
        external_recipient_id: recipient.externalId,
        ...(provider === 'firma' ? { firma_recipient_id: recipient.externalId } : {}),
      })
      .eq('agreement_id', agreementId).eq('role', recipient.key).select('id').single()
    if (error) throw new Error(error.message)
    if (!data) throw new Error(`Could not persist exact recipient mapping for ${recipient.key}`)
  }
}

export async function recordRecipientState(client: SupabaseClient, input: {
  agreementId: string; email: string; status: string; viewedAt?: string | null; signedAt?: string | null
}) {
  return one(client.from('engagement_agreement_recipients').update({ status: input.status, viewed_at: input.viewedAt ?? null, signed_at: input.signedAt ?? null }).eq('agreement_id', input.agreementId).eq('email', input.email.toLowerCase()).select().single())
}

export async function completeAgreement(client: SupabaseClient, agreementId: string, input: { completedPdfR2Key: string; completedAt?: string }) {
  return one(client.from('engagement_agreements').update({ status: 'completed', completed_r2_key: input.completedPdfR2Key, completed_at: input.completedAt ?? new Date().toISOString() }).eq('id', agreementId).select().single())
}
