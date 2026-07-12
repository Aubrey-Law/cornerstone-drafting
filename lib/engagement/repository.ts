import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngagementInput } from './types'

type Json = Record<string, unknown> | unknown[]

export interface AgreementDraftInput {
  matterId?: string
  leadId?: string
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
    matter_id: input.matterId ?? null,
    lead_id: input.leadId ?? null,
    prepared_by: input.preparedBy ?? null,
  }).select().single())
  const agreementId = agreement.id
  const recipients = [
    { agreement_id: agreementId, recipient_order: 1, role: 'primary', ...input.inputSnapshot.primary, email: input.inputSnapshot.primary.email.toLowerCase() },
    ...(input.inputSnapshot.spouse
      ? [{ agreement_id: agreementId, recipient_order: 2, role: 'spouse', ...input.inputSnapshot.spouse, email: input.inputSnapshot.spouse.email.toLowerCase() }]
      : []),
  ]
  const { error: recipientError } = await client.from('engagement_agreement_recipients').insert(recipients)
  if (recipientError) throw new Error(recipientError.message)
  return createAgreementRevision(client, agreementId, input)
}

export async function createAgreementRevision(
  client: SupabaseClient,
  agreementId: string,
  input: Omit<AgreementDraftInput, 'matterId' | 'leadId' | 'preparedBy'>,
) {
  const revision = await one<{ id: string }>(client.from('engagement_agreement_revisions').insert({
    agreement_id: agreementId,
    input_snapshot: input.inputSnapshot,
    render_snapshot: input.renderSnapshot ?? {},
    render_sha256: input.renderSha256,
    master_version: input.masterVersion,
    html_r2_key: input.htmlR2Key ?? null,
    pdf_r2_key: input.pdfR2Key ?? null,
  }).select().single())
  await one(client.from('engagement_agreements').update({
    active_revision_id: revision.id,
    status: 'draft',
  }).eq('id', agreementId).select().single())
  return { agreementId, revision }
}

export async function getAgreement(client: SupabaseClient, agreementId: string) {
  return one(client.from('engagement_agreements').select(
    '*, active_revision:engagement_agreement_revisions!active_revision_id(*), recipients:engagement_agreement_recipients(*)',
  ).eq('id', agreementId).single())
}

export async function claimAgreementSend(client: SupabaseClient, input: {
  agreementId: string
  revisionId: string
  renderSha256: string
  approvalNonce: string
  sentBy: string
}) {
  return one(client.rpc('claim_engagement_agreement_send', {
    p_agreement_id: input.agreementId,
    p_revision_id: input.revisionId,
    p_render_sha256: input.renderSha256,
    p_approval_nonce: input.approvalNonce,
    p_sent_by: input.sentBy,
  }).single())
}

export async function recordFirmaRequest(client: SupabaseClient, agreementId: string, firmaRequestId: string) {
  return one(client.from('engagement_agreements').update({ firma_request_id: firmaRequestId, status: 'sent', sent_at: new Date().toISOString() }).eq('id', agreementId).select().single())
}

export async function recordRecipientState(client: SupabaseClient, input: {
  agreementId: string; email: string; status: string; viewedAt?: string | null; signedAt?: string | null
}) {
  return one(client.from('engagement_agreement_recipients').update({ status: input.status, viewed_at: input.viewedAt ?? null, signed_at: input.signedAt ?? null }).eq('agreement_id', input.agreementId).eq('email', input.email.toLowerCase()).select().single())
}

export async function completeAgreement(client: SupabaseClient, agreementId: string, input: { completedPdfR2Key: string; completedAt?: string }) {
  return one(client.from('engagement_agreements').update({ status: 'completed', completed_r2_key: input.completedPdfR2Key, completed_at: input.completedAt ?? new Date().toISOString() }).eq('id', agreementId).select().single())
}
