import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { engagementAnchorMarkers, type EngagementAnchorMarkers } from '@/lib/engagement/anchors'

/**
 * What a signing session is a session *for*.
 *
 * The native engine signs a PDF: mint a token, stamp the marks, keep a trail,
 * print a certificate. None of that cares what the document is. The wiring
 * did — the signing route read `engagement_agreement_recipients` directly, so
 * the only signable thing in the app was an engagement agreement.
 *
 * This is the seam. A session names exactly one owner (the database enforces
 * the XOR, see 20261212000000_signature_requests.sql) and this resolves it to
 * the handful of facts the signing path actually needs. Callers stop asking
 * "which table?" and ask "who signs, where do the marks go, where does the
 * finished file belong?".
 *
 * Adding a third kind of signable document means adding a branch here and
 * nothing else.
 */

export type SigningSubjectKind = 'engagement' | 'document'

export interface SigningSubjectRecipient {
  /** 1-based, and the number the anchor markers are keyed on. */
  position: number
  /** Matches `esign_signing_sessions.recipient_key`. */
  key: string
  name: string
  email: string
}

export interface SigningSubject {
  kind: SigningSubjectKind
  /** The owning row's id — an agreement id or a signature-request id. */
  ownerId: string
  /** Which column on esign_signing_sessions / esign_audit_events owns it. */
  ownerColumn: 'agreement_id' | 'signature_request_id'
  /** The bytes the recipient reviews and signs. */
  pdfKey: string
  /** Where the executed file is written. */
  sealedKey: string
  /** Every recipient, in signing order. */
  recipients: SigningSubjectRecipient[]
  /** Anchor markers for a 1-based position. */
  markersFor: (position: number) => EngagementAnchorMarkers
  /** Human label for email subjects and the certificate, e.g. "engagement agreement". */
  label: string
}

/**
 * The markers a generated signature page carries.
 *
 * A separate namespace from the engagement template's `[[CLIENT_n_*]]`
 * deliberately: an uploaded PDF could itself contain a pasted engagement
 * template, and two copies of the same marker make `locateAnchors` throw
 * `marker_duplicated` — which is the good outcome. The bad one would be a
 * marker that resolves to the wrong place.
 */
export function documentAnchorMarkers(position: number): EngagementAnchorMarkers {
  return {
    signature: `[[SIGN_${position}_SIGNATURE]]`,
    date: `[[SIGN_${position}_DATE]]`,
  }
}

/** The R2 layout, which both the writer and the signing route reconstruct. */
export function signingPdfKey(ownerId: string): string {
  return `esign/${ownerId}/agreement.pdf`
}

export function signedPdfKey(ownerId: string): string {
  return `esign/${ownerId}/signed.pdf`
}

/** The owning ids carried on a session row. Exactly one is ever set. */
export interface SigningSessionOwner {
  agreement_id: string | null
  signature_request_id?: string | null
}

export class SigningSubjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SigningSubjectError'
  }
}

export async function resolveSigningSubject(session: SigningSessionOwner): Promise<SigningSubject> {
  const admin = getAdminClient()

  if (session.agreement_id) {
    // Recipients are read in agreement order rather than one row for this
    // signer, because the markers are numbered by position in that order. The
    // send path derives them the same way (anchorsFor, lib/engagement/service.ts),
    // and asking only for this recipient's own recipient_order would work today
    // and diverge silently the moment those values are non-contiguous.
    const { data, error } = await admin
      .from('engagement_agreement_recipients')
      .select('name, email, role, recipient_order')
      .eq('agreement_id', session.agreement_id)
      .order('recipient_order', { ascending: true })
    if (error) throw new SigningSubjectError(error.message)

    return {
      kind: 'engagement',
      ownerId: session.agreement_id,
      ownerColumn: 'agreement_id',
      pdfKey: signingPdfKey(session.agreement_id),
      sealedKey: signedPdfKey(session.agreement_id),
      recipients: (data ?? []).map((row, index) => ({
        position: index + 1,
        key: row.role as string,
        name: row.name as string,
        email: row.email as string,
      })),
      markersFor: engagementAnchorMarkers,
      label: 'engagement agreement',
    }
  }

  const requestId = session.signature_request_id
  if (!requestId) {
    // The database will not produce this: esign_signing_sessions_owner_check
    // requires exactly one owner. Refusing loudly is still right — a session
    // with no subject cannot be signed onto anything.
    throw new SigningSubjectError('This signing session belongs to no document')
  }

  const [{ data: request, error: requestError }, { data: recipients, error: recipientError }] =
    await Promise.all([
      admin.from('signature_requests').select('id, name').eq('id', requestId).maybeSingle(),
      admin
        .from('signature_request_recipients')
        .select('name, email, recipient_key, recipient_order')
        .eq('request_id', requestId)
        .order('recipient_order', { ascending: true }),
    ])
  if (requestError) throw new SigningSubjectError(requestError.message)
  if (recipientError) throw new SigningSubjectError(recipientError.message)
  if (!request) throw new SigningSubjectError('This signing session belongs to no document')

  return {
    kind: 'document',
    ownerId: requestId,
    ownerColumn: 'signature_request_id',
    pdfKey: signingPdfKey(requestId),
    sealedKey: signedPdfKey(requestId),
    recipients: (recipients ?? []).map((row, index) => ({
      position: index + 1,
      key: row.recipient_key as string,
      name: row.name as string,
      email: row.email as string,
    })),
    markersFor: documentAnchorMarkers,
    label: (request.name as string) || 'document',
  }
}
