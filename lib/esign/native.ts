import 'server-only'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Client, r2Bucket } from '@/lib/r2'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { putFileToR2 } from '@/lib/documentUpload'
import { sendEmail } from '@/lib/email/send'
import { createSigningToken } from '@/lib/esign/nativeTokens'
import { locateAnchors } from '@/lib/esign/nativeAnchors'
import type {
  EsignArtifact,
  EsignDocumentRequestInput,
  EsignDocumentRequestResult,
  EsignDocumentRequestState,
  EsignDocumentRequestStatus,
  EsignEnvelopeState,
  EsignProvider,
  EsignProviderCapabilities,
  EsignSigner,
} from '@/lib/esign/types'

/**
 * Cornerstone's own signing provider.
 *
 * Implements the same EsignProvider seam Firma does, so selecting it is one
 * line in lib/engagement/runtime.ts. Everything it needs lives in this
 * database and this R2 bucket: no document leaves the firm's infrastructure to
 * be signed.
 *
 * The document is rendered and approved before it gets here
 * (lib/engagement/render.ts, which already asserts US Letter), so this module
 * only ever stamps and stores bytes it was handed.
 */

const SIGNING_PATH = '/sign'

function appOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || process.env.CORNERSTONE_ORIGIN?.trim()
  if (!origin) {
    // A signing link with no origin is a link to nowhere, emailed to a client.
    // Better to refuse the send than to deliver one.
    throw new Error('NEXT_PUBLIC_APP_URL must be set to send native signing links')
  }
  return origin.replace(/\/$/, '')
}

function signingUrl(token: string): string {
  return `${appOrigin()}${SIGNING_PATH}/${token}`
}

/** Map stored session rows onto the contract's request status. */
function statusFromSessions(
  sessions: Array<{ status: string }>,
): EsignDocumentRequestStatus {
  if (sessions.length === 0) return 'created'
  if (sessions.every(s => s.status === 'signed')) return 'completed'
  if (sessions.some(s => s.status === 'declined')) return 'declined'
  if (sessions.some(s => s.status === 'signed')) return 'partially_signed'
  if (sessions.every(s => s.status === 'expired')) return 'expired'
  if (sessions.some(s => s.status === 'viewed')) return 'viewed'
  return 'sent'
}

function envelopeStatusFrom(status: EsignDocumentRequestStatus): EsignEnvelopeState['status'] {
  switch (status) {
    case 'completed': return 'signed'
    case 'declined':
    case 'cancelled':
    case 'expired': return 'declined'
    case 'partially_signed': return 'partially_signed'
    case 'viewed': return 'viewed'
    case 'sent': return 'sent'
    default: return 'unknown'
  }
}

class NativeEsignProvider implements EsignProvider {
  readonly name = 'native' as const

  /**
   * Cornerstone renders its own audit certificate as a page bound into the
   * signed document, so there is no separate certificate artifact to offer.
   * Embedded signing is false because the signer leaves for /sign/<token>
   * rather than signing inside the staff workspace.
   */
  readonly capabilities: EsignProviderCapabilities = {
    resend: true,
    cancel: true,
    embeddedSigning: false,
    separateAuditCertificate: false,
  }

  /**
   * Stash the approved PDF, mint one signing session per recipient, and hand
   * back their links.
   *
   * Anchors are located here rather than at signing time so a template whose
   * markers cannot be resolved fails while an attorney is still watching,
   * instead of when a client opens the link.
   */
  async createDocumentRequest(input: EsignDocumentRequestInput): Promise<EsignDocumentRequestResult> {
    const keys = new Set(input.recipients.map(r => r.key))
    if (keys.size !== input.recipients.length || input.anchors.some(a => !keys.has(a.recipientKey))) {
      throw new Error('Every e-sign anchor must reference one unique recipient key')
    }

    await locateAnchors(input.document, input.anchors.map(a => a.marker))

    const admin = getAdminClient()

    // The agreement's own id, not a fresh one. Two things depend on it and
    // both are load-bearing: esign_signing_sessions.agreement_id is a foreign
    // key to engagement_agreements(id), so an invented id cannot be inserted
    // at all, and the signing route reads the document back from
    // `esign/${session.agreement_id}/agreement.pdf` — a key it can only
    // reconstruct if this is where the document was put.
    //
    // A vendor provider returns an id from its own system. This provider is
    // the system, so the request and the agreement are the same thing.
    const requestId = input.agreementId?.trim()
    if (!requestId) {
      throw new Error('A native e-sign document request needs the agreement it belongs to')
    }
    const r2Key = `esign/${requestId}/agreement.pdf`
    await putFileToR2(r2Key, input.document, 'application/pdf')

    const recipients: EsignDocumentRequestResult['recipients'] = []
    for (const recipient of [...input.recipients].sort((a, b) => a.order - b.order)) {
      const token = createSigningToken(new Date(), Math.ceil(input.expirationHours / 24))
      const { data, error } = await admin
        .from('esign_signing_sessions')
        .upsert({
          agreement_id: requestId,
          recipient_key: recipient.key,
          token_hash: token.tokenHash,
          expires_at: token.expiresAt,
          status: 'sent',
        }, { onConflict: 'agreement_id,recipient_key' })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      recipients.push({ key: recipient.key, externalId: data.id as string, signingLink: signingUrl(token.token) })
    }

    return { requestId, recipients }
  }

  /**
   * Email each recipient their link.
   *
   * Goes through sendEmail, so the EMAILS_ENABLED kill switch, the allowlist,
   * the test-inbox redirect and the email_log row all apply exactly as they do
   * to every other message the firm sends.
   */
  async sendDocumentRequest(requestId: string, customMessage: string): Promise<void> {
    await this.notify(requestId, customMessage, 'esign_signature_request')
  }

  async resendDocumentRequest(input: {
    requestId: string
    recipientIds: string[]
    customMessage?: string
  }): Promise<void> {
    await this.notify(
      input.requestId,
      input.customMessage ?? '',
      'esign_signature_reminder',
      new Set(input.recipientIds),
    )
  }

  private async notify(
    requestId: string,
    customMessage: string,
    category: 'esign_signature_request' | 'esign_signature_reminder',
    onlySessionIds?: Set<string>,
  ): Promise<void> {
    const admin = getAdminClient()
    const { data: sessions, error } = await admin
      .from('esign_signing_sessions')
      .select('id, recipient_key, status')
      .eq('agreement_id', requestId)
    if (error) throw new Error(error.message)

    const { data: recipients, error: recipientError } = await admin
      .from('engagement_agreement_recipients')
      .select('role, name, email')
      .eq('agreement_id', requestId)
    if (recipientError) throw new Error(recipientError.message)
    const byRole = new Map((recipients ?? []).map(r => [r.role as string, r]))

    for (const session of sessions ?? []) {
      if (onlySessionIds && !onlySessionIds.has(session.id as string)) continue
      const recipient = byRole.get(session.recipient_key as string)
      if (!recipient) continue

      // The raw token is not recoverable — only its hash was stored — so a
      // notification always carries a freshly minted link and supersedes the
      // previous one. That is the cost of never persisting the secret, and it
      // is the right trade.
      const token = createSigningToken()
      const { error: rotateError } = await admin
        .from('esign_signing_sessions')
        .update({ token_hash: token.tokenHash, expires_at: token.expiresAt, updated_at: new Date().toISOString() })
        .eq('id', session.id)
      if (rotateError) throw new Error(rotateError.message)

      await sendEmail({
        category,
        to: recipient.email as string,
        subject: 'Your engagement agreement is ready to sign',
        text: [
          `${recipient.name as string},`,
          '',
          customMessage || 'Your engagement agreement is ready for your signature.',
          '',
          signingUrl(token.token),
        ].join('\n'),
      })

      await admin.from('esign_audit_events').insert({
        session_id: session.id,
        agreement_id: requestId,
        event_type: 'emailed',
        detail: { category },
      })
    }
  }

  async getDocumentRequestState(requestId: string): Promise<EsignDocumentRequestState> {
    const admin = getAdminClient()
    const { data: sessions, error } = await admin
      .from('esign_signing_sessions')
      .select('id, recipient_key, status')
      .eq('agreement_id', requestId)
    if (error) throw new Error(error.message)

    return {
      status: statusFromSessions(sessions ?? []),
      recipients: (sessions ?? []).map(s => ({
        key: s.recipient_key as string,
        externalId: s.id as string,
        signingLink: null,   // Links are single-use and not recoverable.
      })),
      artifacts: await this.artifactsFor(requestId),
    }
  }

  async getEnvelopeState(envelopeId: string): Promise<EsignEnvelopeState> {
    const admin = getAdminClient()
    const { data: sessions, error } = await admin
      .from('esign_signing_sessions')
      .select('recipient_key, status, signed_at, declined_at')
      .eq('agreement_id', envelopeId)
    if (error) throw new Error(error.message)

    const { data: recipients } = await admin
      .from('engagement_agreement_recipients')
      .select('role, email')
      .eq('agreement_id', envelopeId)
    const emailByRole = new Map((recipients ?? []).map(r => [r.role as string, r.email as string]))

    const status = statusFromSessions(sessions ?? [])
    const signedAt = (sessions ?? [])
      .map(s => s.signed_at as string | null)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null

    return {
      status: envelopeStatusFrom(status),
      signedAt: status === 'completed' ? signedAt : null,
      artifacts: await this.artifactsFor(envelopeId),
      recipients: (sessions ?? []).map(s => ({
        email: (emailByRole.get(s.recipient_key as string) ?? '').toLowerCase(),
        status: s.status === 'signed' ? 'signed' as const
          : s.status === 'declined' ? 'declined' as const
            : 'sent' as const,
        signedAt: s.signed_at as string | null,
        declinedAt: s.declined_at as string | null,
      })),
    }
  }

  /** The sealed document, as a short-lived presigned URL. */
  private async artifactsFor(requestId: string): Promise<EsignArtifact[]> {
    const admin = getAdminClient()
    const { data } = await admin
      .from('engagement_esign_artifacts')
      .select('kind, r2_key')
      .eq('agreement_id', requestId)
      .eq('kind', 'combined_evidence')
      .maybeSingle()
    if (!data) return []

    const url = await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: r2Bucket(), Key: data.r2_key as string }),
      { expiresIn: 300 },
    )
    return [{ kind: 'combined_evidence', url, mimeType: 'application/pdf' }]
  }

  async cancelDocumentRequest(requestId: string, reason: string): Promise<void> {
    const admin = getAdminClient()
    const { error } = await admin
      .from('esign_signing_sessions')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('agreement_id', requestId)
      .in('status', ['sent', 'viewed'])
    if (error) throw new Error(error.message)

    // `cancelled`, not `declined`. This trail is read back and printed onto
    // the audit certificate of everything later sealed for this agreement,
    // where `declined` reads as the client having refused to sign — an act of
    // the firm attributed to the person who did not do it, on the one artifact
    // that exists to be evidence. Rows written before this keep their old
    // value: the table is append-only, and it records what was written then.
    await admin.from('esign_audit_events').insert({
      agreement_id: requestId,
      event_type: 'cancelled',
      detail: { reason },
    })
  }

  /** Best-effort supersede, used before a re-send. */
  async cancelEnvelope(envelopeId: string): Promise<void> {
    try {
      await this.cancelDocumentRequest(envelopeId, 'Superseded by a re-sent engagement agreement')
    } catch (e) {
      console.warn('[esign native] cancel envelope failed (ignored)', e)
    }
  }

  /**
   * The legacy template flow has no local document to stamp — its document
   * lives in a vendor template — so this provider cannot serve it. Throwing is
   * the honest answer; returning a fabricated envelope id would strand a send.
   */
  async createEngagementEnvelope(
    _input: { primary: EsignSigner; spouse?: EsignSigner },
  ): Promise<{ envelopeId: string; signingLink: string | null }> {
    throw new Error(
      'The native e-signature provider does not support the legacy template flow. '
        + 'Send this agreement from the engagement workspace, or leave the firm on Firma for it.',
    )
  }
}

export function createNativeEsignProvider(): EsignProvider {
  return new NativeEsignProvider()
}

/**
 * Whether this firm signs through Cornerstone rather than the vendor.
 *
 * Mirrors billingMilestonesEnabled() in lib/billing/schedules.ts: ships dark,
 * read per send so a cutover can be reversed without a deploy.
 */
export async function esignNativeEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('esign_native_enabled')
    .eq('id', 1)
    .maybeSingle()
  return !error && data?.esign_native_enabled === true
}
