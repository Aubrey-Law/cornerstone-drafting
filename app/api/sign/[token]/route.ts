import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getR2Client, r2Bucket } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { putFileToR2 } from '@/lib/documentUpload'
import { hashSigningToken, signingSessionGate } from '@/lib/esign/nativeTokens'
import { sealSignedAgreement } from '@/lib/esign/nativeSeal'
import { sealFieldsFor, type SignedMark } from '@/lib/esign/sealFields'
import type { SealSigner } from '@/lib/esign/nativeSeal'
import { ESIGN_CONSENT_TEXT, consentTextSha256 } from '@/lib/esign/consent'
import { completeWorkspaceAgreement } from '@/lib/esign/completion'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'
import { getSchedulingSettings } from '@/lib/appointments/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/sign/[token] — a client signs or declines their agreement.
 *
 * Public by design: the token is the credential, and it is verified here
 * rather than by the proxy, which does not match this path. That follows the
 * pattern already used by the booking manage links and intake invites — the
 * security boundary is the hash comparison below, not a database policy.
 *
 * The route reads through the service-role client because no signed-in user
 * exists. Everything it will act on is scoped by the session the token
 * resolves to; nothing here takes an id from the request body.
 */

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? null
}

type SessionRow = {
  id: string
  agreement_id: string
  recipient_key: string
  status: string
  expires_at: string
}

/** Resolve a presented token to its session, or explain why it cannot be used. */
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

async function resolveSession(token: string): Promise<
  { ok: true; session: SessionRow } | { ok: false; status: number; error: string }
> {
  const admin = getAdminClient()
  // Look up by hash. The raw token is never stored, so this is the only way to
  // find the row — and it means a database dump yields no usable links.
  const { data, error } = await admin
    .from('esign_signing_sessions')
    .select('id, agreement_id, recipient_key, status, expires_at')
    .eq('token_hash', hashSigningToken(token))
    .maybeSingle()
  if (error) {
    console.error('[esign sign] session lookup failed', error)
    return { ok: false, status: 500, error: 'Could not open this signing link' }
  }
  // A wrong token and a revoked one look identical on purpose: neither tells
  // the holder whether a link ever existed.
  if (!data) return { ok: false, status: 404, error: 'This signing link is not valid' }

  const gate = signingSessionGate(data as SessionRow)
  if (!gate.ok) {
    const message = gate.reason === 'already_signed'
      ? 'This agreement has already been signed'
      : gate.reason === 'declined'
        ? 'This agreement was declined'
        : 'This signing link has expired'
    return { ok: false, status: 410, error: message }
  }
  return { ok: true, session: data as SessionRow }
}

async function recordAudit(input: {
  sessionId: string
  agreementId: string
  eventType: string
  req: Request
  detail?: Record<string, unknown>
}): Promise<void> {
  const { error } = await getAdminClient().from('esign_audit_events').insert({
    session_id: input.sessionId,
    agreement_id: input.agreementId,
    event_type: input.eventType,
    ip: clientIp(input.req),
    user_agent: input.req.headers.get('user-agent'),
    detail: input.detail ?? {},
  })
  // The audit trail is the evidence. If it cannot be written, the signing must
  // not proceed as though it had been.
  if (error) throw new Error(`Could not record the ${input.eventType} audit event: ${error.message}`)
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await guardPublicSchedulingRoute(req, 'esign-sign', 20)
  if (limited) return limited

  const { token } = await params
  const resolved = await resolveSession(token)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const session = resolved.session

  let body: {
    action?: unknown
    typedName?: unknown
    signaturePngBase64?: unknown
    declineReason?: unknown
    consentAccepted?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = getAdminClient()
  const now = new Date().toISOString()

  if (body.action === 'decline') {
    // Declining is a first-class outcome, not an error path. The reason is
    // optional: a client should not have to justify themselves to proceed.
    await recordAudit({
      sessionId: session.id,
      agreementId: session.agreement_id,
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
    return NextResponse.json({ ok: true, outcome: 'declined' })
  }

  if (body.action !== 'sign') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }
  if (body.consentAccepted !== true) {
    // Without consent there is no ESIGN signature to record, so this is a
    // refusal rather than a signature with a caveat.
    return NextResponse.json(
      { error: 'Electronic signature consent is required before signing' },
      { status: 400 },
    )
  }

  const typedName = typeof body.typedName === 'string' ? body.typedName.trim() : ''
  const signaturePng = typeof body.signaturePngBase64 === 'string' && body.signaturePngBase64
    ? Buffer.from(body.signaturePngBase64.replace(/^data:image\/png;base64,/, ''), 'base64')
    : null
  if (!typedName && !signaturePng) {
    return NextResponse.json({ error: 'A signature is required' }, { status: 400 })
  }

  await recordAudit({
    sessionId: session.id,
    agreementId: session.agreement_id,
    eventType: 'consented',
    req,
    detail: { consent_text_sha256: consentTextSha256() },
  })

  // Load the approved PDF — the exact bytes the client reviewed.
  const pdf = await downloadFromR2(`esign/${session.agreement_id}/agreement.pdf`)
  if (!pdf) {
    return NextResponse.json({ error: 'Could not load the agreement' }, { status: 502 })
  }

  // Load every recipient in agreement order, not just this one. The markers are
  // numbered by position in that order — `anchorsFor` in lib/engagement/service.ts
  // derives them the same way when the request is sent — so the position has to be
  // read off the same ordered list. Asking only for this recipient's
  // `recipient_order` would work today but silently diverge the moment those
  // values are ever non-contiguous.
  const { data: roster } = await admin
    .from('engagement_agreement_recipients')
    .select('name, email, role, recipient_order')
    .eq('agreement_id', session.agreement_id)
    .order('recipient_order', { ascending: true })

  const orderedRecipients = roster ?? []
  const position = orderedRecipients.findIndex(r => r.role === session.recipient_key) + 1
  if (position === 0) {
    // No guessing here. A default position would stamp this signature on some
    // other signer's line and produce an executed agreement that looks finished
    // and is wrong — far worse than refusing to sign.
    console.error('[esign sign] recipient not found on agreement', {
      agreementId: session.agreement_id,
      recipientKey: session.recipient_key,
    })
    return NextResponse.json({ error: 'Could not sign this agreement' }, { status: 500 })
  }
  const recipient = orderedRecipients[position - 1]

  await recordAudit({ sessionId: session.id, agreementId: session.agreement_id, eventType: 'signed', req })

  // session_id comes back so each trail line can name its signer. Without it a
  // couple's ten events render as one list in which nothing says who opened,
  // consented or signed — and this certificate is what the firm would produce
  // to show that a particular person signed.
  const { data: trail } = await admin
    .from('esign_audit_events')
    .select('event_type, occurred_at, ip, user_agent, session_id')
    .eq('agreement_id', session.agreement_id)
    .order('occurred_at', { ascending: true })

  // Everyone who has signed, not just whoever just finished.
  //
  // The sealed file is rebuilt from the approved PDF on every signature, which
  // is what keeps one audit certificate on it rather than one per signer. Doing
  // that with a single signer's fields is what executed the first real
  // agreement with `[[CLIENT_2_SIGNATURE]]` still printed on it: the spouse
  // sealed first, the primary reloaded the original, and the overwrite erased
  // her. Position comes from the same ordered roster the markers do.
  const positionOf = new Map(orderedRecipients.map((r, index) => [r.role as string, index + 1]))
  const { data: priorSessions } = await admin
    .from('esign_signing_sessions')
    .select('id, recipient_key, signed_at')
    .eq('agreement_id', session.agreement_id)
    .eq('status', 'signed')
    .neq('id', session.id)

  const nameOf = new Map(orderedRecipients.map(r => [r.role as string, r.name as string]))
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
        agreementId: session.agreement_id,
        recipientKey: prior.recipient_key,
      })
      return NextResponse.json({ error: 'Could not sign this agreement' }, { status: 500 })
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
    ], timezone),
    // Every signer, in agreement order, so a couple's certificate names both
    // rather than whoever happened to seal last.
    signers: [...priorSigners, {
      name: (recipient?.name as string) ?? typedName,
      email: (recipient?.email as string) ?? '',
      adoptionMethod: signaturePng ? ('drawn' as const) : ('typed' as const),
      signedAt: new Date(now),
    }].sort((a, b) => (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0)),
    agreementId: session.agreement_id,
    consentText: ESIGN_CONSENT_TEXT,
    auditTrail: (trail ?? []).map(entry => ({
      eventType: entry.event_type as string,
      occurredAt: entry.occurred_at as string,
      ip: entry.ip as string | null,
      userAgent: entry.user_agent as string | null,
      signerName: signerBySession.get(entry.session_id as string) ?? null,
    })),
  })

  const sealedKey = `esign/${session.agreement_id}/signed.pdf`
  await putFileToR2(sealedKey, sealed.pdf, 'application/pdf')

  const { error: artifactError } = await admin
    .from('esign_signature_artifacts')
    .upsert({
      session_id: session.id,
      ...(signaturePng ? { signature_png_r2_key: `esign/${session.agreement_id}/${session.id}-signature.png` } : {}),
      typed_name: typedName || null,
      adoption_method: signaturePng ? 'drawn' : 'typed',
      consent_text_sha256: consentTextSha256(),
    }, { onConflict: 'session_id' })
  if (artifactError) throw new Error(artifactError.message)

  if (signaturePng) {
    await putFileToR2(`esign/${session.agreement_id}/${session.id}-signature.png`, signaturePng, 'image/png')
  }

  const { error: sessionError } = await admin
    .from('esign_signing_sessions')
    .update({ status: 'signed', signed_at: now, updated_at: now })
    .eq('id', session.id)
  if (sessionError) throw new Error(sessionError.message)

  await recordAudit({
    sessionId: session.id,
    agreementId: session.agreement_id,
    eventType: 'sealed',
    req,
    detail: { sha256: sealed.sha256, source_sha256: sealed.sourceSha256 },
  })

  // Register the sealed document as this agreement's evidence, then let the
  // shared completion module finish exactly as the webhook path does — that is
  // the point of it being shared.
  const { data: agreement } = await admin
    .from('engagement_agreements')
    .select('id, matter_id')
    .eq('id', session.agreement_id)
    .maybeSingle()

  const { data: remaining } = await admin
    .from('esign_signing_sessions')
    .select('id')
    .eq('agreement_id', session.agreement_id)
    .neq('status', 'signed')

  if (agreement?.matter_id && (remaining ?? []).length === 0) {
    await admin.from('engagement_esign_artifacts').upsert({
      agreement_id: session.agreement_id,
      kind: 'combined_evidence',
      provider: 'native',
      external_request_id: session.agreement_id,
      r2_key: sealedKey,
      sha256: sealed.sha256,
      byte_size: sealed.pdf.length,
      mime_type: 'application/pdf',
      retrieved_at: now,
    }, { onConflict: 'agreement_id,kind' })

    const completed = await completeWorkspaceAgreement(admin, {
      agreementId: session.agreement_id,
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
      externalRequestId: session.agreement_id,
    })
    if (!completed.ok) {
      // The signature is recorded and the sealed document is stored; only the
      // downstream bookkeeping deferred. The reconciliation sweep picks it up,
      // so the client is told they are done, because they are.
      console.error('[esign sign] completion deferred', completed.error)
    }
  }

  return NextResponse.json({ ok: true, outcome: 'signed', sha256: sealed.sha256 })
}

/** GET — the signing page's own data fetch; also records that it was opened. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveSession(token)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const session = resolved.session
  const admin = getAdminClient()

  if (session.status === 'sent') {
    await admin
      .from('esign_signing_sessions')
      .update({ status: 'viewed', viewed_at: new Date().toISOString() })
      .eq('id', session.id)
    await recordAudit({ sessionId: session.id, agreementId: session.agreement_id, eventType: 'opened', req })
  }

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: r2Bucket(), Key: `esign/${session.agreement_id}/agreement.pdf` }),
    { expiresIn: 300 },
  )

  const { data: recipient } = await admin
    .from('engagement_agreement_recipients')
    .select('name, email')
    .eq('agreement_id', session.agreement_id)
    .eq('role', session.recipient_key)
    .maybeSingle()

  return NextResponse.json({
    documentUrl: url,
    signer: { name: recipient?.name ?? '', email: recipient?.email ?? '' },
    consentText: ESIGN_CONSENT_TEXT,
    consentSha256: createHash('sha256').update(ESIGN_CONSENT_TEXT, 'utf8').digest('hex'),
  })
}
