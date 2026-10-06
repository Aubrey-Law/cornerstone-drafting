import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { putFileToR2 } from '@/lib/documentUpload'
import { createSigningToken } from '@/lib/esign/nativeTokens'
import { locateAnchors } from '@/lib/esign/nativeAnchors'
import { appendSignaturePage } from '@/lib/esign/signaturePage'
import { documentAnchorMarkers, signingPdfKey } from '@/lib/esign/subject'
import { CEREMONY_ATTESTATION_TEXT, MAX_SIGNERS } from '@/lib/esign/ceremony'
import { DocumentSignatureError, emailSigningLink } from '@/lib/esign/documentLifecycle'

/**
 * Sending a document the firm did not author out for signature.
 *
 * Deliberately *not* routed through the EsignProvider seam. That seam exists so
 * an engagement agreement can be signed by Firma or by this engine, and it is
 * shaped around an engagement: createDocumentRequest writes
 * `agreement_id: requestId`, notify reads engagement_agreement_recipients, and
 * Firma is never going to sign an arbitrary uploaded PDF. Forcing this through
 * it would mean widening a contract for a second implementation that will never
 * exist. So this uses the same primitives — tokens, anchors, R2, email — and
 * owns its own persistence.
 *
 * What it shares with the engagement path is everything after the link is sent:
 * one signing route, one token scheme, one audit trail, one sealing step.
 */

/**
 * The wording an attorney is shown and agrees to before a document is sent, and
 * the signer ceiling the signature page imposes.
 *
 * Both live in a module the send dialog can import too — it has to show the same
 * wording this stores, and offer the same number of signer rows the send will
 * accept. Re-exported here so every existing importer is unchanged.
 */
export { CEREMONY_ATTESTATION_TEXT, MAX_SIGNERS } from '@/lib/esign/ceremony'

// Re-exported so every existing importer of this module is unchanged.
export {
  DocumentSignatureError,
  cancelDocumentSignatureRequest,
  esignDocumentsEnabled,
  resendDocumentSignatureLink,
} from '@/lib/esign/documentLifecycle'

/** A signer on an uploaded document. Positional, like the anchor markers. */
export interface DocumentSigner {
  name: string
  email: string
  /** Printed above the signature line, e.g. "Client". Optional. */
  role?: string
}

export interface CreateDocumentSignatureRequestInput {
  matterId: string
  /** The matter_documents row the PDF came from, for provenance. */
  sourceDocumentId: string | null
  /** Shown to the signer and used as the email subject. */
  name: string
  sourcePdf: Buffer
  sourceR2Key: string
  signers: DocumentSigner[]
  message: string
  expirationHours: number
  /** The attorney who attested. Without this, nothing is sent. */
  attestedBy: string
}

export async function createDocumentSignatureRequest(
  input: CreateDocumentSignatureRequestInput,
): Promise<{ requestId: string; recipients: Array<{ key: string; email: string }> }> {
  // The G.L. c. 190B gate. The database refuses to let a request leave draft
  // without an attestation; refusing here means the row is never created at
  // all, and the message names the actual reason.
  if (!input.attestedBy) {
    throw new DocumentSignatureError(
      'A document cannot be sent for signature until the sender confirms it needs no witnessed or '
        + 'notarized signing ceremony',
    )
  }
  if (input.signers.length === 0) {
    throw new DocumentSignatureError('A signature request needs at least one signer')
  }
  if (input.signers.length > MAX_SIGNERS) {
    throw new DocumentSignatureError(`A signature request takes at most ${MAX_SIGNERS} signers`)
  }
  const emails = input.signers.map(s => s.email.trim().toLowerCase())
  if (emails.some(email => !email.includes('@'))) {
    throw new DocumentSignatureError('Every signer needs an email address')
  }
  if (new Set(emails).size !== emails.length) {
    // Two sessions for one address would send two links to one inbox, and the
    // second would supersede the first's token — leaving one signer unable to
    // sign whichever line they were not sent.
    throw new DocumentSignatureError('Each signer needs their own email address')
  }

  const admin = getAdminClient()

  // Append first. It reads the upload's text layer to refuse a document that
  // already carries these markers, and doing it before any row exists means a
  // refusal leaves nothing behind.
  const prepared = await appendSignaturePage(
    input.sourcePdf,
    input.signers.map(s => ({ name: s.name, role: s.role })),
    { title: input.name },
  )

  const { data: created, error: createError } = await admin
    .from('signature_requests')
    .insert({
      matter_id: input.matterId,
      source_document_id: input.sourceDocumentId,
      name: input.name,
      source_r2_key: input.sourceR2Key,
      status: 'draft',
    })
    .select('id')
    .single()
  if (createError) throw new DocumentSignatureError(createError.message)
  const requestId = created.id as string

  try {
    const { error: recipientError } = await admin.from('signature_request_recipients').insert(
      input.signers.map((signer, index) => ({
        request_id: requestId,
        recipient_order: index + 1,
        recipient_key: `signer_${index + 1}`,
        name: signer.name.trim(),
        email: emails[index],
      })),
    )
    if (recipientError) throw new DocumentSignatureError(recipientError.message)

    const preparedKey = signingPdfKey(requestId)
    await putFileToR2(preparedKey, prepared, 'application/pdf')

    // Prove the anchors resolve before anyone is emailed. The engagement path
    // does the same, and for the same reason: an anchor failure discovered at
    // signing time is a client staring at an error.
    const markers = input.signers.flatMap((_, index) => {
      const { signature, date } = documentAnchorMarkers(index + 1)
      return [signature, date]
    })
    await locateAnchors(prepared, markers)

    const now = new Date().toISOString()
    const sessions: Array<{ key: string; email: string; token: string }> = []
    for (const [index, signer] of input.signers.entries()) {
      const key = `signer_${index + 1}`
      const token = createSigningToken(new Date(), Math.ceil(input.expirationHours / 24))
      const { error: sessionError } = await admin.from('esign_signing_sessions').insert({
        signature_request_id: requestId,
        recipient_key: key,
        token_hash: token.tokenHash,
        expires_at: token.expiresAt,
        status: 'sent',
      })
      if (sessionError) throw new DocumentSignatureError(sessionError.message)
      sessions.push({ key, email: emails[index], token: token.token })
      void signer
    }

    // One update carries the attestation, the prepared key and the status
    // together: signature_requests_sendable rejects a row that leaves draft
    // without both, so they cannot be written in separate steps.
    const { error: sendError } = await admin
      .from('signature_requests')
      .update({
        prepared_r2_key: preparedKey,
        ceremony_attested_by: input.attestedBy,
        ceremony_attested_at: now,
        ceremony_attestation_text: CEREMONY_ATTESTATION_TEXT,
        status: 'sent',
        sent_by: input.attestedBy,
        sent_at: now,
        updated_at: now,
      })
      .eq('id', requestId)
    if (sendError) throw new DocumentSignatureError(sendError.message)

    await admin.from('esign_audit_events').insert({
      signature_request_id: requestId,
      event_type: 'sent',
      detail: { name: input.name, signers: input.signers.length },
    })

    for (const [index, session] of sessions.entries()) {
      await emailSigningLink({
        requestId,
        recipientKey: session.key,
        to: session.email,
        signerName: input.signers[index].name,
        documentName: input.name,
        message: input.message,
        token: session.token,
        category: 'esign_signature_request',
      })
    }

    return { requestId, recipients: sessions.map(s => ({ key: s.key, email: s.email })) }
  } catch (error) {
    // Record why, the way releaseAgreementClaim does for engagements — a row
    // saying `failed` and nothing saying why is what made the first native
    // sends so hard to diagnose.
    const message = error instanceof Error ? error.message : String(error)
    await admin
      .from('signature_requests')
      .update({
        status: 'failed',
        provider_sync_error: message.slice(0, 2000),
        provider_sync_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
    throw error
  }
}

/**
 * Finish a document signature request once every signer is done.
 *
 * The engagement equivalent (completeWorkspaceAgreement) hires the matter,
 * starts the post-engagement SLA clock and flips
 * matter_details.engagement_signed. None of that belongs to an arbitrary signed
 * PDF — running it would promote a lead off the back of a HIPAA authorisation.
 * So this does only the part that is genuinely shared: the executed file lands
 * in the matter's documents, where anyone looking for it would look.
 *
 * Shared with the client at once, as the signed engagement agreement is
 * (storeSignedEngagement): the signer was just told "a copy has been saved to
 * your matter", and the executed copy of something they signed is theirs to
 * keep. The portal gets the usual "a document is ready" notice.
 */
export async function completeDocumentSignature(input: {
  requestId: string
  sealedPdf: Buffer
  sha256: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = getAdminClient()

  const { data: request, error } = await admin
    .from('signature_requests')
    .select('id, matter_id, name, status')
    .eq('id', input.requestId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!request) return { ok: false, error: 'Signature request not found' }
  if (request.status === 'completed') return { ok: true }
  // Cancelling closes the sessions, so a signer should never reach this with a
  // withdrawn request. Defence in depth: the alternative is filing an executed
  // copy of a document the firm took back.
  if (request.status === 'cancelled') {
    return { ok: false, error: 'This signature request was withdrawn' }
  }

  const matterId = request.matter_id as string
  const safeName = String(request.name)
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .trim()
    .slice(0, 80) || 'signed-document'
  const r2Key = `matters/${matterId}/signed/${input.requestId}-${safeName}.pdf`

  await putFileToR2(r2Key, input.sealedPdf, 'application/pdf')

  const now = new Date().toISOString()
  const documentName = `${safeName} - signed.pdf`
  const { error: documentError } = await admin.from('matter_documents').insert({
    matter_id: matterId,
    r2_key: r2Key,
    name: documentName,
    size: input.sealedPdf.length,
    content_type: 'application/pdf',
    source: 'firm',
    shared_at: now,
  })
  // A duplicate r2_key means this already ran; that is idempotent, not an error.
  if (documentError && !/duplicate key/i.test(documentError.message)) {
    return { ok: false, error: documentError.message }
  }

  const { error: statusError } = await admin
    .from('signature_requests')
    .update({ status: 'completed', completed_r2_key: r2Key, completed_at: now, updated_at: now })
    .eq('id', input.requestId)
  if (statusError) return { ok: false, error: statusError.message }

  if (!documentError) {
    // Fire-and-forget by design (the helper logs rather than throws): the
    // request is complete whether or not the notice goes out.
    const { notifyClientOfSharedDocument } = await import('@/lib/portalNotifications')
    await notifyClientOfSharedDocument(matterId, documentName)
  }

  return { ok: true }
}
