import 'server-only'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Client, r2Bucket } from '@/lib/r2'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveEsignProvider } from '@/lib/esign/firma'
import { reconcileAgreement } from '@/lib/esign/reconcile'
import type { EsignArtifactKind, EsignProviderCapabilities } from '@/lib/esign/types'

/**
 * What staff can do with an engagement agreement after it has been sent.
 *
 * Every action here is server-authorized and idempotent, and none of them can
 * mark an agreement signed: completion only ever follows an authoritative
 * provider response, whether that arrives by webhook or by reconciliation. A
 * button in a browser is a request to go and check, never a statement of fact.
 */

/** Statuses where a request is still live with the provider. */
const LIVE_STATUSES = new Set(['sending', 'sent', 'viewed', 'partially_signed'])

/** Recipients worth re-notifying: they have not acted yet. */
const UNSIGNED_RECIPIENT_STATUSES = new Set(['pending', 'sent', 'viewed'])

export type EngagementStatusView = {
  agreementId: string
  status: string
  provider: string
  externalRequestId: string | null
  sentAt: string | null
  completedAt: string | null
  lastProviderSyncAt: string | null
  providerSyncError: string | null
  providerSyncErrorAt: string | null
  capabilities: EsignProviderCapabilities | null
  /** False when the agreement is already finished — nothing left to act on. */
  live: boolean
  recipients: Array<{
    id: string
    role: string
    name: string
    email: string
    order: number
    status: string
    sentAt: string | null
    viewedAt: string | null
    signedAt: string | null
    declinedAt: string | null
    lastRemindedAt: string | null
    externalRecipientId: string | null
    /** Whether a resend would target this recipient. */
    resendEligible: boolean
  }>
  artifacts: Array<{
    kind: EsignArtifactKind
    sha256: string
    byteSize: number
    mimeType: string
    retrievedAt: string
  }>
}

const AGREEMENT_COLUMNS =
  'id, status, provider, external_request_id, firma_request_id, matter_id, sent_at, completed_at, last_provider_sync_at, provider_sync_error, provider_sync_error_at'

export async function getEngagementStatus(agreementId: string): Promise<EngagementStatusView> {
  const admin = getAdminClient()
  const { data: agreement, error } = await admin
    .from('engagement_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('id', agreementId)
    .single()
  if (error) throw new Error(error.message)

  const { data: recipients, error: recipientError } = await admin
    .from('engagement_agreement_recipients')
    .select('id, role, name, email, recipient_order, status, sent_at, viewed_at, signed_at, declined_at, last_reminded_at, external_recipient_id, firma_recipient_id')
    .eq('agreement_id', agreementId)
    .order('recipient_order', { ascending: true })
  if (recipientError) throw new Error(recipientError.message)

  const { data: artifacts, error: artifactError } = await admin
    .from('engagement_esign_artifacts')
    .select('kind, sha256, byte_size, mime_type, retrieved_at')
    .eq('agreement_id', agreementId)
  if (artifactError) throw new Error(artifactError.message)

  const resolved = resolveEsignProvider()
  const live = LIVE_STATUSES.has(agreement.status as string)

  return {
    agreementId: agreement.id as string,
    status: agreement.status as string,
    provider: (agreement.provider as string) ?? 'firma',
    externalRequestId: (agreement.external_request_id ?? agreement.firma_request_id ?? null) as string | null,
    sentAt: agreement.sent_at as string | null,
    completedAt: agreement.completed_at as string | null,
    lastProviderSyncAt: agreement.last_provider_sync_at as string | null,
    providerSyncError: agreement.provider_sync_error as string | null,
    providerSyncErrorAt: agreement.provider_sync_error_at as string | null,
    // Null when e-signature is not configured at all, which the UI shows as
    // "unavailable" rather than as a set of dead buttons.
    capabilities: resolved.ok ? resolved.provider.capabilities : null,
    live,
    recipients: (recipients ?? []).map(r => ({
      id: r.id as string,
      role: r.role as string,
      name: r.name as string,
      email: r.email as string,
      order: r.recipient_order as number,
      status: r.status as string,
      sentAt: r.sent_at as string | null,
      viewedAt: r.viewed_at as string | null,
      signedAt: r.signed_at as string | null,
      declinedAt: r.declined_at as string | null,
      lastRemindedAt: r.last_reminded_at as string | null,
      externalRecipientId: (r.external_recipient_id ?? r.firma_recipient_id ?? null) as string | null,
      resendEligible: live && UNSIGNED_RECIPIENT_STATUSES.has(r.status as string),
    })),
    artifacts: (artifacts ?? []).map(a => ({
      kind: a.kind as EsignArtifactKind,
      sha256: a.sha256 as string,
      byteSize: a.byte_size as number,
      mimeType: a.mime_type as string,
      retrievedAt: a.retrieved_at as string,
    })),
  }
}

/** Re-check authoritative provider state now, rather than waiting for the sweep. */
export async function refreshEngagementStatus(agreementId: string): Promise<EngagementStatusView> {
  const resolved = resolveEsignProvider()
  if (!resolved.ok) throw new Error(resolved.error)

  const admin = getAdminClient()
  const { data: agreement, error } = await admin
    .from('engagement_agreements')
    .select('id, matter_id, status, provider, external_request_id, firma_request_id')
    .eq('id', agreementId)
    .single()
  if (error) throw new Error(error.message)

  // Reuses the reconciliation path rather than repeating it: a manual refresh
  // and the background sweep must reach the same conclusion from the same
  // provider response, or staff will see one answer and the cron another.
  await reconcileAgreement(admin, resolved.provider, agreement as Parameters<typeof reconcileAgreement>[2])
  return getEngagementStatus(agreementId)
}

/**
 * Re-notify specific unsigned recipients.
 *
 * Eligibility is recomputed server-side from current state: a stale browser
 * must not be able to email someone who has already signed, and "resend to
 * everyone" is never the default.
 */
export async function resendEngagementRecipients(input: {
  agreementId: string
  recipientIds: string[]
  customMessage?: string
}): Promise<EngagementStatusView> {
  const resolved = resolveEsignProvider()
  if (!resolved.ok) throw new Error(resolved.error)
  if (!resolved.provider.capabilities.resend) {
    throw new Error('This e-signature provider does not support resending')
  }

  const status = await getEngagementStatus(input.agreementId)
  if (!status.live) throw new Error(`Cannot resend an agreement in status ${status.status}`)
  if (!status.externalRequestId) throw new Error('This agreement has no provider request to resend')

  const requested = new Set(input.recipientIds)
  const targets = status.recipients.filter(r => requested.has(r.id) && r.resendEligible)
  if (targets.length === 0) throw new Error('No eligible unsigned recipient was selected')

  const externalIds = targets
    .map(r => r.externalRecipientId)
    .filter((id): id is string => Boolean(id))
  if (externalIds.length !== targets.length) {
    throw new Error('A selected recipient has no provider identity yet; refresh and try again')
  }

  await resolved.provider.resendDocumentRequest({
    requestId: status.externalRequestId,
    recipientIds: externalIds,
    ...(input.customMessage ? { customMessage: input.customMessage } : {}),
  })

  const admin = getAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('engagement_agreement_recipients')
    .update({ last_reminded_at: now })
    .in('id', targets.map(r => r.id))
  if (error) throw new Error(error.message)

  return getEngagementStatus(input.agreementId)
}

/** Cancel a live request with the provider, then mark the agreement cancelled. */
export async function cancelEngagementRequest(input: {
  agreementId: string
  reason: string
}): Promise<EngagementStatusView> {
  const resolved = resolveEsignProvider()
  if (!resolved.ok) throw new Error(resolved.error)
  if (!resolved.provider.capabilities.cancel) {
    throw new Error('This e-signature provider does not support cancelling')
  }

  const status = await getEngagementStatus(input.agreementId)
  if (status.status === 'completed') throw new Error('A completed agreement cannot be cancelled')
  if (!status.live) throw new Error(`Cannot cancel an agreement in status ${status.status}`)
  if (!status.externalRequestId) throw new Error('This agreement has no provider request to cancel')

  // Provider first: marking it cancelled locally while the signing link still
  // works would leave a client able to sign an agreement the firm considers
  // withdrawn.
  await resolved.provider.cancelDocumentRequest(status.externalRequestId, input.reason)

  const admin = getAdminClient()
  const { error } = await admin
    .from('engagement_agreements')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', input.agreementId)
    .neq('status', 'completed')
  if (error) throw new Error(error.message)

  return getEngagementStatus(input.agreementId)
}

/** A short-lived download URL for one stored evidence artifact. */
export async function engagementArtifactUrl(input: {
  agreementId: string
  kind: EsignArtifactKind
}): Promise<{ url: string; mimeType: string }> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('engagement_esign_artifacts')
    .select('r2_key, mime_type')
    .eq('agreement_id', input.agreementId)
    .eq('kind', input.kind)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('That evidence artifact is not available for this agreement')

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: r2Bucket(), Key: data.r2_key as string }),
    { expiresIn: 300 },
  )
  return { url, mimeType: (data.mime_type as string) ?? 'application/pdf' }
}
