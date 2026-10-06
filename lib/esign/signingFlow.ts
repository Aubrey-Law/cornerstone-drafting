import 'server-only'

import { createHash } from 'node:crypto'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getR2Client, r2Bucket } from '@/lib/r2'
import { putFileToR2 } from '@/lib/documentUpload'
import type { SigningSessionRow } from '@/lib/esign/signingSession'
import { sealSignedAgreement, type SealSigner } from '@/lib/esign/nativeSeal'
import { sealFieldsFor, type SignedMark } from '@/lib/esign/sealFields'
import { resolveSigningSubject, type SigningSubjectKind } from '@/lib/esign/subject'
import { ESIGN_CONSENT_TEXT, consentTextSha256 } from '@/lib/esign/consent'
import { completeWorkspaceAgreement } from '@/lib/esign/completion'
import { completeDocumentSignature } from '@/lib/esign/documentSignature'
import { getSchedulingSettings } from '@/lib/appointments/settings'

/**
 * The signing flow itself: open a session, sign or decline it, seal and file.
 *
 * Two doors lead here and share nothing else. The public route
 * (`/api/sign/[token]`) admits whoever holds the emailed token; the portal
 * route (`/api/documents/sign/[sessionId]`) admits the signed-in client whose
 * email the session was sent to. Both hand a resolved, gate-checked session to
 * these functions, so the audit trail, the sealing and the completion are one
 * code path however the signer arrived. Nothing here takes an id from a request
 * body: the session is the only thing acted on.
 */

// The session row, its columns and the open/closed gate live in
// lib/esign/signingSession.ts (no PDF dependencies) and are re-exported here
// so a door needs one import.
export {
  gateRefusal,
  loadSigningSessionById,
  SIGNING_SESSION_COLUMNS,
  type SigningRefusal,
  type SigningSessionRow,
} from '@/lib/esign/signingSession'

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? null
}

/**
 * Read an object out of R2.
 *
 * Used for the approved PDF and for an earlier signer's drawing, which is
 * fetched back because the seal is rebuilt from the original document on every
 * signature and therefore has to redraw every mark, not only the newest one.
 */
async function downloadFromR2(key: string): Promise<Buffer | null> {
  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: r2Bucket(), Key: key }),
    { expiresIn: 300 },
  )
  const response = await fetch(url)
  if (!response.ok) return null
  return Buffer.from(await response.arrayBuffer())
}

/**
 * The owning column for a session, as an insert fragment.
 *
 * esign_audit_events carries the same exactly-one-owner rule as the sessions
 * table, so an event is filed against whichever one the session has. Reading it
 * off the session rather than the resolved subject keeps the audit writes that
 * happen before the subject is needed — opened, consented, declined — from
 * depending on it.
 */
function auditOwner(session: SigningSessionRow): Record<string, string> {
  if (session.agreement_id) return { agreement_id: session.agreement_id }
  if (session.signature_request_id) return { signature_request_id: session.signature_request_id }
  throw new Error('This signing session belongs to no document')
}

async function recordAudit(input: {
  session: SigningSessionRow
  eventType: string
  req: Request
  detail?: Record<string, unknown>
}): Promise<void> {
  const { error } = await getAdminClient().from('esign_audit_events').insert({
    session_id: input.session.id,
    ...auditOwner(input.session),
    event_type: input.eventType,
    ip: clientIp(input.req),
    user_agent: input.req.headers.get('user-agent'),
    detail: input.detail ?? {},
  })
  // The audit trail is the evidence. If it cannot be written, the signing must
  // not proceed as though it had been.
  if (error) throw new Error(`Could not record the ${input.eventType} audit event: ${error.message}`)
}

export interface OpenedSigningSession {
  documentUrl: string
  signer: { name: string; email: string }
  consentText: string
  consentSha256: string
  /** What is being signed, for the page's heading: 'engagement' or an uploaded document. */
  kind: SigningSubjectKind
  /** "engagement agreement", or the document's own name. */
  label: string
}

/** The signing page's own data fetch; also records that the session was opened. */
export async function openSigningSession(session: SigningSessionRow, req: Request): Promise<OpenedSigningSession> {
  const admin = getAdminClient()
  if (session.status === 'sent') {
    await admin
      .from('esign_signing_sessions')
      .update({ status: 'viewed', viewed_at: new Date().toISOString() })
      .eq('id', session.id)
    await recordAudit({ session, eventType: 'opened', req })
  }

  const subject = await resolveSigningSubject(session)
  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: r2Bucket(), Key: subject.pdfKey }),
    { expiresIn: 300 },
  )
  const recipient = subject.recipients.find(r => r.key === session.recipient_key)

  return {
    documentUrl: url,
    signer: { name: recipient?.name ?? '', email: recipient?.email ?? '' },
    consentText: ESIGN_CONSENT_TEXT,
    consentSha256: createHash('sha256').update(ESIGN_CONSENT_TEXT, 'utf8').digest('hex'),
    kind: subject.kind,
    label: subject.label,
  }
}

export type SigningOutcome =
  | { status: 200; body: { ok: true; outcome: 'declined' } | { ok: true; outcome: 'signed'; sha256: string } }
  | { status: 400 | 500 | 502; body: { error: string } }

/** A client signs or declines. The body is whatever the request carried; it is validated here. */
export async function submitSigning(session: SigningSessionRow, rawBody: unknown, req: Request): Promise<SigningOutcome> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as {
    action?: unknown
    typedName?: unknown
    signaturePngBase64?: unknown
    declineReason?: unknown
    consentAccepted?: unknown
  }
  const admin = getAdminClient()
  const now = new Date().toISOString()

  if (body.action === 'decline') {
    // Declining is a first-class outcome, not an error path. The reason is
    // optional: a client should not have to justify themselves to proceed.
    await recordAudit({
      session,
      eventType: 'declined',
      req,
      detail: typeof body.declineReason === 'string' ? { reason: body.declineReason.trim() } : {},
    })
    const { error } = await admin
      .from('esign_signing_sessions')
      .update({
        status: 'declined',
        declined_at: now,
        decline_reason: typeof body.declineReason === 'string' ? body.declineReason.trim() : null,
        updated_at: now,
      })
      .eq('id', session.id)
    if (error) throw new Error(error.message)
    return { status: 200, body: { ok: true, outcome: 'declined' } }
  }

  if (body.action !== 'sign') {
    return { status: 400, body: { error: 'Unsupported action' } }
  }
  if (body.consentAccepted !== true) {
    // Without consent there is no ESIGN signature to record, so this is a
    // refusal rather than a signature with a caveat.
    return { status: 400, body: { error: 'Electronic signature consent is required before signing' } }
  }

  const typedName = typeof body.typedName === 'string' ? body.typedName.trim() : ''
  const signaturePng = typeof body.signaturePngBase64 === 'string' && body.signaturePngBase64
    ? Buffer.from(body.signaturePngBase64.replace(/^data:image\/png;base64,/, ''), 'base64')
    : null
  if (!typedName && !signaturePng) {
    return { status: 400, body: { error: 'A signature is required' } }
  }

  await recordAudit({
    session,
    eventType: 'consented',
    req,
    detail: { consent_text_sha256: consentTextSha256() },
  })

  // What this session is a session *for*. Everything below reads the document,
  // its signers and its marker namespace through this rather than assuming an
  // engagement agreement — see lib/esign/subject.ts.
  const subject = await resolveSigningSubject(session)

  // Load the approved PDF — the exact bytes the client reviewed.
  const pdf = await downloadFromR2(subject.pdfKey)
  if (!pdf) {
    return { status: 502, body: { error: 'Could not load the agreement' } }
  }

  // Every recipient in agreement order, not just this one. The markers are
  // numbered by position in that order — `anchorsFor` in lib/engagement/service.ts
  // derives them the same way when the request is sent — so the position has to be
  // read off the same ordered list. Asking only for this recipient's
  // `recipient_order` would work today but silently diverge the moment those
  // values are ever non-contiguous.
  const orderedRecipients = subject.recipients
  const position = orderedRecipients.findIndex(r => r.key === session.recipient_key) + 1
  if (position === 0) {
    // No guessing here. A default position would stamp this signature on some
    // other signer's line and produce an executed agreement that looks finished
    // and is wrong — far worse than refusing to sign.
    console.error('[esign sign] recipient not found on agreement', {
      ownerId: subject.ownerId,
      recipientKey: session.recipient_key,
    })
    return { status: 500, body: { error: 'Could not sign this agreement' } }
  }
  const recipient = orderedRecipients[position - 1]

  await recordAudit({ session, eventType: 'signed', req })

  // session_id comes back so each trail line can name its signer. Without it a
  // couple's ten events render as one list in which nothing says who opened,
  // consented or signed — and this certificate is what the firm would produce
  // to show that a particular person signed.
  const { data: trail } = await admin
    .from('esign_audit_events')
    .select('event_type, occurred_at, ip, user_agent, session_id')
    .eq(subject.ownerColumn, subject.ownerId)
    .order('occurred_at', { ascending: true })

  // Everyone who has signed, not just whoever just finished.
  //
  // The sealed file is rebuilt from the approved PDF on every signature, which
  // is what keeps one audit certificate on it rather than one per signer. Doing
  // that with a single signer's fields is what executed the first real
  // agreement with `[[CLIENT_2_SIGNATURE]]` still printed on it: the spouse
  // sealed first, the primary reloaded the original, and the overwrite erased
  // her. Position comes from the same ordered roster the markers do.
  const positionOf = new Map(orderedRecipients.map((r, index) => [r.key, index + 1]))
  const { data: priorSessions } = await admin
    .from('esign_signing_sessions')
    .select('id, recipient_key, signed_at')
    .eq(subject.ownerColumn, subject.ownerId)
    .eq('status', 'signed')
    .neq('id', session.id)

  const nameOf = new Map(orderedRecipients.map(r => [r.key, r.name]))
  // session id -> signer name, for attributing the audit trail.
  const signerBySession = new Map<string, string>([[session.id, (recipient?.name as string) ?? typedName]])

  const priorMarks: SignedMark[] = []
  const priorSigners: SealSigner[] = []
  for (const prior of priorSessions ?? []) {
    const priorPosition = positionOf.get(prior.recipient_key as string)
    if (!priorPosition) {
      // Same refusal as above: a signature whose position cannot be resolved
      // must not be dropped from the document silently.
      console.error('[esign sign] prior signer not found on agreement', {
        ownerId: subject.ownerId,
        recipientKey: prior.recipient_key,
      })
      return { status: 500, body: { error: 'Could not sign this agreement' } }
    }
    const { data: artifact } = await admin
      .from('esign_signature_artifacts')
      .select('typed_name, signature_png_r2_key')
      .eq('session_id', prior.id as string)
      .maybeSingle()
    const priorKey = prior.recipient_key as string
    const priorRecipient = orderedRecipients[priorPosition - 1]
    priorMarks.push({
      position: priorPosition,
      signedAt: new Date(prior.signed_at as string),
      typedName: (artifact?.typed_name as string | null) ?? null,
      signaturePng: artifact?.signature_png_r2_key
        ? await downloadFromR2(artifact.signature_png_r2_key as string)
        : null,
    })
    priorSigners.push({
      name: nameOf.get(priorKey) ?? priorKey,
      email: (priorRecipient?.email as string) ?? '',
      adoptionMethod: artifact?.signature_png_r2_key ? 'drawn' : 'typed',
      signedAt: new Date(prior.signed_at as string),
    })
    signerBySession.set(prior.id as string, nameOf.get(priorKey) ?? priorKey)
  }

  // The signature lines are dated in the firm's own zone, never in whatever
  // zone the machine doing the sealing runs in — UTC on the deployed runtime,
  // the developer's own locally. An agreement signed between 8pm and midnight
  // Eastern would otherwise carry the following day's date.
  const { timezone } = await getSchedulingSettings()

  const sealed = await sealSignedAgreement({
    pdf,
    fields: sealFieldsFor([
      ...priorMarks,
      // This signer's own mark is passed in rather than read back: the session
      // is not marked `signed` until after sealing succeeds, and that ordering
      // is what lets a failed seal be retried.
      {
        position,
        signedAt: new Date(now),
        ...(signaturePng ? { signaturePng } : { typedName }),
      },
    ], timezone, subject.markersFor),
    // Every signer, in agreement order, so a couple's certificate names both
    // rather than whoever happened to seal last.
    signers: [...priorSigners, {
      name: (recipient?.name as string) ?? typedName,
      email: (recipient?.email as string) ?? '',
      adoptionMethod: signaturePng ? ('drawn' as const) : ('typed' as const),
      signedAt: new Date(now),
    }].sort((a, b) => (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0)),
    agreementId: subject.ownerId,
    consentText: ESIGN_CONSENT_TEXT,
    auditTrail: (trail ?? []).map(entry => ({
      eventType: entry.event_type as string,
      occurredAt: entry.occurred_at as string,
      ip: entry.ip as string | null,
      userAgent: entry.user_agent as string | null,
      signerName: signerBySession.get(entry.session_id as string) ?? null,
    })),
  })

  const sealedKey = subject.sealedKey
  await putFileToR2(sealedKey, sealed.pdf, 'application/pdf')

  const { error: artifactError } = await admin
    .from('esign_signature_artifacts')
    .upsert({
      session_id: session.id,
      ...(signaturePng ? { signature_png_r2_key: `esign/${subject.ownerId}/${session.id}-signature.png` } : {}),
      typed_name: typedName || null,
      adoption_method: signaturePng ? 'drawn' : 'typed',
      consent_text_sha256: consentTextSha256(),
    }, { onConflict: 'session_id' })
  if (artifactError) throw new Error(artifactError.message)

  if (signaturePng) {
    await putFileToR2(`esign/${subject.ownerId}/${session.id}-signature.png`, signaturePng, 'image/png')
  }

  const { error: sessionError } = await admin
    .from('esign_signing_sessions')
    .update({ status: 'signed', signed_at: now, updated_at: now })
    .eq('id', session.id)
  if (sessionError) throw new Error(sessionError.message)

  await recordAudit({
    session,
    eventType: 'sealed',
    req,
    detail: { sha256: sealed.sha256, source_sha256: sealed.sourceSha256 },
  })

  // Register the sealed document as this agreement's evidence, then let the
  // shared completion module finish exactly as the webhook path does — that is
  // the point of it being shared.
  //
  // Engagement-only, deliberately. completeWorkspaceAgreement hires the matter,
  // starts the post-engagement SLA clock and flips
  // matter_details.engagement_signed; none of that is right for an arbitrary
  // signed document, which has its own completion step below.
  const { data: agreement } = subject.kind === 'engagement'
    ? await admin
      .from('engagement_agreements')
      .select('id, matter_id')
      .eq('id', subject.ownerId)
      .maybeSingle()
    : { data: null }

  const { data: remaining } = await admin
    .from('esign_signing_sessions')
    .select('id')
    .eq(subject.ownerColumn, subject.ownerId)
    .neq('status', 'signed')

  const everyoneHasSigned = (remaining ?? []).length === 0

  // An uploaded document finishes here: the executed file lands in the matter's
  // documents, shared with the client who signed it, and the request is marked
  // complete. Nothing else — the engagement completion below hires matters and
  // starts SLA clocks, which a HIPAA authorisation has no business doing.
  if (subject.kind === 'document' && everyoneHasSigned) {
    const completed = await completeDocumentSignature({
      requestId: subject.ownerId,
      sealedPdf: sealed.pdf,
      sha256: sealed.sha256,
    })
    if (!completed.ok) {
      // The signature is recorded and the sealed file is stored; only the
      // filing failed. Say so rather than telling the signer their signature
      // did not take.
      console.error('[esign sign] document completion failed', {
        requestId: subject.ownerId,
        error: completed.error,
      })
    }
  }

  if (agreement?.matter_id && everyoneHasSigned) {
    await admin.from('engagement_esign_artifacts').upsert({
      agreement_id: subject.ownerId,
      kind: 'combined_evidence',
      provider: 'native',
      external_request_id: subject.ownerId,
      r2_key: sealedKey,
      sha256: sealed.sha256,
      byte_size: sealed.pdf.length,
      mime_type: 'application/pdf',
      retrieved_at: now,
    }, { onConflict: 'agreement_id,kind' })

    const completed = await completeWorkspaceAgreement(admin, {
      agreementId: subject.ownerId,
      matterId: agreement.matter_id as string,
      state: {
        status: 'signed',
        signedAt: now,
        artifacts: [{ kind: 'combined_evidence', url: await getSignedUrl(
          getR2Client(),
          new GetObjectCommand({ Bucket: r2Bucket(), Key: sealedKey }),
          { expiresIn: 300 },
        ), mimeType: 'application/pdf' }],
        recipients: [],
      },
      provider: 'native',
      externalRequestId: subject.ownerId,
    })
    if (!completed.ok) {
      // The signature is recorded and the sealed document is stored; only the
      // downstream bookkeeping deferred. The reconciliation sweep picks it up,
      // so the client is told they are done, because they are.
      console.error('[esign sign] completion deferred', completed.error)
    }
  }

  return { status: 200, body: { ok: true, outcome: 'signed', sha256: sealed.sha256 } }
}
