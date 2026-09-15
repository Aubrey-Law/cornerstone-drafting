import 'server-only'

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { syncEngagementSignedAnchor } from '@/lib/engagement/signedDate'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'
import { primaryEvidenceArtifact, type EsignArtifact, type EsignEnvelopeState, type EsignProviderName } from '@/lib/esign/types'

/**
 * What happens after an engagement agreement is signed, independent of who
 * witnessed the signing.
 *
 * This logic used to live inside the Firma webhook route. It is extracted
 * because a second provider signs in-process rather than by webhook, and two
 * copies of "download the evidence, store it, flip the matter, start the SLA
 * clock" would drift the moment either is touched. The webhook is now one
 * caller of this module rather than its owner.
 *
 * Callers differ in how they must react to a deferral, so nothing here returns
 * an HTTP response: a webhook wants a non-2xx so the provider retries, while an
 * in-process signing wants to retry itself. `retryable` carries that
 * distinction and each caller renders it in its own vocabulary.
 */

export type CompletionFailure = { ok: false; retryable: boolean; error: string }
export type StoredEngagement = { ok: true; r2Key: string; sha256: string; byteSize: number }

function failure(error: string, retryable: boolean): CompletionFailure {
  return { ok: false, retryable, error }
}

/**
 * Persist one downloaded evidence artifact and register it against the
 * agreement. Registration is best-effort: the bytes are already safe in R2 and
 * on `matter_documents`, so a bookkeeping failure must not fail a completed
 * signing.
 */
async function recordArtifact(
  admin: SupabaseClient,
  input: {
    agreementId: string
    provider: EsignProviderName
    externalRequestId: string | null
    artifact: EsignArtifact
    r2Key: string
    sha256: string
    byteSize: number
  },
): Promise<void> {
  const { error } = await admin
    .from('engagement_esign_artifacts')
    .upsert({
      agreement_id: input.agreementId,
      kind: input.artifact.kind,
      provider: input.provider,
      external_request_id: input.externalRequestId,
      r2_key: input.r2Key,
      sha256: input.sha256,
      byte_size: input.byteSize,
      mime_type: input.artifact.mimeType,
      retrieved_at: new Date().toISOString(),
    }, { onConflict: 'agreement_id,kind' })
  if (error) console.error('[esign completion] artifact registration failed', error)
}

/**
 * Download the signed evidence into the matter's documents, flip the matter's
 * engagement state, and start the post-engagement SLA clock.
 *
 * Ordering is deliberate: the status flip happens last, so a retry after a
 * partial failure redoes the upload (worst case one orphaned R2 object) while a
 * retry after success is a no-op.
 */
export async function storeSignedEngagement(
  admin: SupabaseClient,
  input: {
    matterId: string
    state: EsignEnvelopeState
    agreementId?: string
    provider: EsignProviderName
    externalRequestId?: string | null
  },
): Promise<StoredEngagement | CompletionFailure> {
  const artifact = primaryEvidenceArtifact(input.state.artifacts)
  // Evidence can lag the signing event while the audit certificate generates.
  // That is a "come back shortly", not a failure.
  if (!artifact) {
    return failure('signed document not ready yet', true)
  }

  const download = await fetch(artifact.url)
  if (!download.ok) {
    return failure('signed document download failed', true)
  }
  const buffer = Buffer.from(await download.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const { data: matter } = await admin
    .from('v_matter_pipeline')
    .select('client_name')
    .eq('matter_id', input.matterId)
    .maybeSingle()
  const displayName = `Engagement Agreement - ${matter?.client_name ?? 'Client'} - signed.pdf`
  const filename = safeUploadFilename(displayName)
  const r2Key = input.agreementId
    ? `matters/${input.matterId}/signed/engagement-agreement-${input.agreementId}.pdf`
    : `matters/${input.matterId}/signed/${Date.now()}-${filename}`
  await putFileToR2(r2Key, buffer, 'application/pdf')

  const { data: existingDocument, error: documentReadError } = await admin
    .from('matter_documents')
    .select('id')
    .eq('matter_id', input.matterId)
    .eq('r2_key', r2Key)
    .maybeSingle()
  if (documentReadError) throw new Error(documentReadError.message)
  if (!existingDocument) {
    const { error: docError } = await admin.from('matter_documents').insert({
      ...(input.agreementId ? { id: input.agreementId } : {}),
      matter_id: input.matterId,
      r2_key: r2Key,
      name: displayName,
      size: buffer.length,
      content_type: 'application/pdf',
      source: 'firm',
      shared_at: new Date().toISOString(),
      uploaded_by: null,
    })
    if (docError && !(input.agreementId && docError.code === '23505')) throw new Error(docError.message)
  }

  if (input.agreementId) {
    await recordArtifact(admin, {
      agreementId: input.agreementId,
      provider: input.provider,
      externalRequestId: input.externalRequestId ?? null,
      artifact,
      r2Key,
      sha256,
      byteSize: buffer.length,
    })
  }

  const signedAt = input.state.signedAt ?? new Date().toISOString()
  const { error: updateError } = await admin
    .from('matter_details')
    .update({
      engagement_signed: true,
      engagement_status: 'signed',
      engagement_signed_at: signedAt,
    })
    .eq('client_id', input.matterId)
  if (updateError) throw new Error(updateError.message)

  // Signing starts the post-engagement SLA clock, which is anchored on
  // `matters`. Every signed-engagement branch reaches this function, so the
  // clock moves whether the envelope was sent from a lead or a hired matter.
  const { error: anchorError } = await syncEngagementSignedAnchor(admin, input.matterId, signedAt)
  if (anchorError) throw new Error(anchorError)

  return { ok: true, r2Key, sha256, byteSize: buffer.length }
}

/**
 * Promote the owning opportunity to a hired matter if it is not one already.
 *
 * A lost opportunity is a deliberate dead end: someone marked it lost, and a
 * signature arriving afterwards is a contradiction a human should look at
 * rather than something to resolve automatically.
 */
export async function ensureMatterHired(
  admin: SupabaseClient,
  matterId: string,
): Promise<{ ok: true } | CompletionFailure> {
  const { data: matter, error } = await admin
    .from('matters')
    .select('id, client_intake_id, relationship_status')
    .eq('id', matterId)
    .single()
  if (error) throw new Error(error.message)
  if (matter.relationship_status === 'lost') {
    return failure('lost opportunity must be reactivated before hiring', false)
  }
  if (matter.relationship_status !== 'hired') {
    const promoted = await createMatterFromIntake(admin, matter.client_intake_id as string)
    if (!promoted.ok) return failure(promoted.error, false)
  }
  return { ok: true }
}

/**
 * The whole completion path for a workspace-flow agreement: promote the
 * opportunity, store the evidence, and mark the agreement completed.
 *
 * Both the Firma webhook and the native signing route call this, which is the
 * point — it is the only place that knows what "completed" means.
 */
export async function completeWorkspaceAgreement(
  admin: SupabaseClient,
  input: {
    agreementId: string
    matterId: string
    state: EsignEnvelopeState
    provider: EsignProviderName
    externalRequestId?: string | null
  },
): Promise<{ ok: true; r2Key: string } | CompletionFailure> {
  const hired = await ensureMatterHired(admin, input.matterId)
  if (!hired.ok) return hired

  const stored = await storeSignedEngagement(admin, {
    matterId: input.matterId,
    state: input.state,
    agreementId: input.agreementId,
    provider: input.provider,
    externalRequestId: input.externalRequestId,
  })
  if (!stored.ok) return stored

  const now = new Date().toISOString()
  const { error } = await admin
    .from('engagement_agreements')
    .update({
      status: 'completed',
      completed_r2_key: stored.r2Key,
      completed_at: input.state.signedAt ?? now,
      updated_at: now,
    })
    .eq('id', input.agreementId)
  if (error) throw new Error(error.message)

  return { ok: true, r2Key: stored.r2Key }
}

/**
 * Apply per-recipient signing state onto the agreement's recipient rows.
 * Recipients are matched by lowercased email, which is how they are stored.
 */
export async function applyRecipientStates(
  admin: SupabaseClient,
  agreementId: string,
  recipients: NonNullable<EsignEnvelopeState['recipients']>,
): Promise<void> {
  const now = new Date().toISOString()
  for (const recipient of recipients) {
    const timestamps = recipient.status === 'signed'
      ? { signed_at: recipient.signedAt ?? now }
      : recipient.status === 'declined'
        ? { declined_at: recipient.declinedAt ?? now }
        : {}
    const { error } = await admin
      .from('engagement_agreement_recipients')
      .update({ status: recipient.status, ...timestamps })
      .eq('agreement_id', agreementId)
      .eq('email', recipient.email.toLowerCase())
    if (error) throw new Error(error.message)
  }
}
