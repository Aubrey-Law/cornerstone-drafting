import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { createSigningToken } from '@/lib/esign/nativeTokens'

/**
 * What happens to a signature request after it has been sent.
 *
 * Split from documentSignature.ts, which owns the send, because the send
 * reaches pdf-lib and pdf.js to append a signature page and cancelling or
 * re-sending touches no PDF at all. Keeping them together dragged 387 pdf.js
 * files and a native canvas binding into the bundle of two routes that never
 * open a document — and tests/esign-pdfjs-bundling.test.ts is right to insist
 * that every route carrying that graph declares it.
 */

export class DocumentSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentSignatureError'
  }
}

/** Read out of firm_settings, failing closed like esignNativeEnabled does. */
export async function esignDocumentsEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('esign_documents_enabled')
    .eq('id', 1)
    .maybeSingle()
  return !error && data?.esign_documents_enabled === true
}

/** Mirrors signingUrl in lib/esign/native.ts, which is module-private there. */
function appOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.CORNERSTONE_ORIGIN
  if (!origin) {
    throw new DocumentSignatureError(
      'NEXT_PUBLIC_APP_URL is not set, so a signing link cannot be built',
    )
  }
  return origin.replace(/\/$/, '')
}

/**
 * One signing link, emailed and recorded.
 *
 * Shared by the send and the resend so the two cannot drift: the same subject,
 * the same body shape, and an `emailed` audit row for each, differing only in
 * the category that says which it was.
 */
export async function emailSigningLink(input: {
  requestId: string
  recipientKey: string
  to: string
  signerName: string
  documentName: string
  message: string
  token: string
  category: 'esign_signature_request' | 'esign_signature_reminder'
}): Promise<void> {
  await sendEmail({
    category: input.category,
    to: input.to,
    subject: `${input.documentName} is ready for your signature`,
    text: [
      `${input.signerName},`,
      '',
      input.message || `${input.documentName} is ready for your signature.`,
      '',
      `${appOrigin()}/sign/${input.token}`,
    ].join('\n'),
  })
  await getAdminClient().from('esign_audit_events').insert({
    signature_request_id: input.requestId,
    event_type: 'emailed',
    detail: { category: input.category, recipient_key: input.recipientKey },
  })
}

/** Statuses in which a request still has links a signer could use. */
const LIVE_REQUEST_STATUSES = new Set(['sending', 'sent', 'viewed', 'partially_signed'])

/**
 * Withdraw a request the firm no longer wants signed.
 *
 * The order is the entire substance of this function. `app/api/sign/[token]`
 * resolves a session by token hash and never reads the parent row, so marking
 * the request cancelled does nothing to the links already in a client's inbox
 * — only the session rows close them. Writing the parent first would leave a
 * window in which the firm believes a document is withdrawn and the client can
 * still execute it.
 *
 * A signed or declined session keeps its outcome: cancelling the request does
 * not unmake a signature, and the certificate has to go on saying so.
 */
export async function cancelDocumentSignatureRequest(input: {
  requestId: string
  reason: string
  cancelledBy: string
}): Promise<{ ok: true }> {
  const reason = input.reason.trim()
  // Stored on the audit row and read back off the certificate, so it has to be
  // worth reading. This is also the confirmation: a deliberate sentence proves
  // more than a boolean the client always sends.
  if (!reason) {
    throw new DocumentSignatureError('Say why this request is being withdrawn')
  }

  const admin = getAdminClient()
  const { data: request, error } = await admin
    .from('signature_requests')
    .select('id, status, name')
    .eq('id', input.requestId)
    .maybeSingle()
  if (error) throw new DocumentSignatureError(error.message)
  if (!request) throw new DocumentSignatureError('Signature request not found')
  if (request.status === 'completed') {
    throw new DocumentSignatureError('This document has been signed and completed; it cannot be withdrawn')
  }
  if (!LIVE_REQUEST_STATUSES.has(String(request.status))) {
    throw new DocumentSignatureError(`This request is not out for signature (${request.status})`)
  }

  // The links first.
  const { error: sessionError } = await admin
    .from('esign_signing_sessions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('signature_request_id', input.requestId)
    .in('status', ['sent', 'viewed'])
  if (sessionError) throw new DocumentSignatureError(sessionError.message)

  // Then the request. `neq` rather than a re-read: a signature landing between
  // the two writes must not be clobbered by this update.
  const now = new Date().toISOString()
  const { error: requestError } = await admin
    .from('signature_requests')
    .update({ status: 'cancelled', updated_at: now })
    .eq('id', input.requestId)
    .neq('status', 'completed')
  if (requestError) throw new DocumentSignatureError(requestError.message)

  await admin.from('esign_audit_events').insert({
    signature_request_id: input.requestId,
    event_type: 'cancelled',
    // No session_id. The firm withdrew this, not a signer, and an event
    // attributed to a session is printed against that signer's name.
    detail: { reason, cancelled_by: input.cancelledBy },
  })

  return { ok: true }
}

/**
 * Send one signer a fresh link.
 *
 * The raw token was never stored, so there is no old link to re-send — a
 * resend mints a new one and the previous link stops working the moment this
 * runs. That is the cost of never persisting the secret, and the dialog says
 * so rather than leaving a client to discover it.
 */
export async function resendDocumentSignatureLink(input: {
  requestId: string
  recipientKey: string
  expirationHours?: number
  message?: string
}): Promise<{ ok: true; email: string }> {
  const admin = getAdminClient()

  const { data: request, error } = await admin
    .from('signature_requests')
    .select('id, status, name')
    .eq('id', input.requestId)
    .maybeSingle()
  if (error) throw new DocumentSignatureError(error.message)
  if (!request) throw new DocumentSignatureError('Signature request not found')
  if (!LIVE_REQUEST_STATUSES.has(String(request.status))) {
    throw new DocumentSignatureError(`This request is not out for signature (${request.status})`)
  }

  const { data: recipient, error: recipientError } = await admin
    .from('signature_request_recipients')
    .select('recipient_key, name, email')
    .eq('request_id', input.requestId)
    .eq('recipient_key', input.recipientKey)
    .maybeSingle()
  if (recipientError) throw new DocumentSignatureError(recipientError.message)
  if (!recipient) throw new DocumentSignatureError('That signer is not on this request')

  const { data: session, error: sessionError } = await admin
    .from('esign_signing_sessions')
    .select('recipient_key, status, expires_at, viewed_at')
    .eq('signature_request_id', input.requestId)
    .eq('recipient_key', input.recipientKey)
    .maybeSingle()
  if (sessionError) throw new DocumentSignatureError(sessionError.message)
  if (!session) throw new DocumentSignatureError('That signer has no signing session yet')
  if (session.status === 'signed') {
    throw new DocumentSignatureError(`${recipient.name} has already signed`)
  }
  if (session.status === 'declined') {
    throw new DocumentSignatureError(`${recipient.name} declined to sign; a new request is needed`)
  }

  const expirationHours = input.expirationHours && input.expirationHours > 0
    ? input.expirationHours
    : 168
  const token = createSigningToken(new Date(), Math.ceil(expirationHours / 24))

  // A lapsed or withdrawn session has to be reopened, or the fresh token lands
  // on a row the gate still refuses and the signer gets a link that does not
  // work. A `sent` or `viewed` session keeps its status untouched, so the fact
  // that they opened the last one survives the resend.
  const reopened = session.status === 'expired' || session.status === 'cancelled'
  const { error: rotateError } = await admin
    .from('esign_signing_sessions')
    .update({
      token_hash: token.tokenHash,
      expires_at: token.expiresAt,
      ...(reopened ? { status: 'sent' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('signature_request_id', input.requestId)
    .eq('recipient_key', input.recipientKey)
  if (rotateError) throw new DocumentSignatureError(rotateError.message)

  await emailSigningLink({
    requestId: input.requestId,
    recipientKey: input.recipientKey,
    to: String(recipient.email),
    signerName: String(recipient.name),
    documentName: String(request.name),
    message: input.message ?? '',
    token: token.token,
    category: 'esign_signature_reminder',
  })

  const { error: reminderError } = await admin
    .from('signature_request_recipients')
    .update({ last_reminded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('request_id', input.requestId)
    .eq('recipient_key', input.recipientKey)
  if (reminderError) throw new DocumentSignatureError(reminderError.message)

  return { ok: true, email: String(recipient.email) }
}

