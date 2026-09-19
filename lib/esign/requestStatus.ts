/**
 * What a signature request is actually doing, derived rather than read.
 *
 * `signature_requests.status` is written in three places and only ever holds
 * `draft`, `sent`, `completed` or `failed`; nothing sets `viewed` or
 * `partially_signed`, and `signature_request_recipients` is inserted once and
 * never touched again. The row that does keep up is
 * `esign_signing_sessions` — the signing route maintains it on every open,
 * consent, signature and decline.
 *
 * So the state an attorney reads comes from the sessions, with the request row
 * consulted only for the things the sessions cannot know: that a send failed,
 * that it was cancelled, or that it never left draft.
 */

export type SignatureRequestState =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'partially_signed'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'failed'

export interface SigningSessionState {
  status: string
  expires_at: string | null
}

export interface DerivedRequestState {
  state: SignatureRequestState
  signedCount: number
  signerCount: number
}

/** A session nobody can act on any more: its outcome is already recorded. */
function isFinished(status: string): boolean {
  return status === 'signed' || status === 'declined'
}

/**
 * Nothing sweeps expiry, so a link past its date still reads `sent`. A finished
 * session's date is irrelevant — it keeps the expires_at it was minted with,
 * which goes into the past like any other.
 */
function isExpired(session: SigningSessionState, now: Date): boolean {
  if (isFinished(session.status)) return false
  if (session.status === 'expired') return true
  return session.expires_at !== null && new Date(session.expires_at).getTime() < now.getTime()
}

export function deriveRequestState(
  request: { status: string },
  sessions: SigningSessionState[],
  now: Date,
): DerivedRequestState {
  const signedCount = sessions.filter(session => session.status === 'signed').length
  const counts = { signedCount, signerCount: sessions.length }

  // Three things the sessions cannot tell us. A failed send may well have
  // created sessions before it threw, so the row wins here.
  if (request.status === 'failed') return { state: 'failed', ...counts }
  if (request.status === 'cancelled') return { state: 'cancelled', ...counts }
  if (request.status === 'draft') return { state: 'draft', ...counts }

  // Everyone signed. Ahead of the decline and expiry checks because
  // completeDocumentSignature runs after the last signature and can fail — the
  // signatures are the fact, the column catching up is not.
  if (request.status === 'completed') return { state: 'signed', ...counts }
  if (sessions.length > 0 && signedCount === sessions.length) return { state: 'signed', ...counts }

  if (sessions.some(session => session.status === 'declined')) return { state: 'declined', ...counts }
  if (sessions.some(session => isExpired(session, now))) return { state: 'expired', ...counts }
  if (signedCount > 0) return { state: 'partially_signed', ...counts }
  if (sessions.some(session => session.status === 'viewed')) return { state: 'viewed', ...counts }
  return { state: 'sent', ...counts }
}

/** What the badge says. Kept beside the derivation so the two cannot drift. */
export const SIGNATURE_REQUEST_LABELS: Record<SignatureRequestState, string> = {
  draft: 'Not sent',
  sent: 'Out for signature',
  viewed: 'Opened by signer',
  partially_signed: 'Partly signed',
  signed: 'Signed',
  declined: 'Declined',
  expired: 'Link expired',
  cancelled: 'Cancelled',
  failed: 'Send failed',
}

/** One signer's progress, as the list endpoint reports it. */
export interface SignatureRequestSigner {
  name: string
  email: string
  /** The session's own status, or `pending` if no session was ever minted. */
  state: string
  viewedAt: string | null
  signedAt: string | null
  declinedAt: string | null
}

/**
 * What the documents tab needs to draw a badge and a signer list. Deliberately
 * carries no token, no token hash and no R2 key — only what an attorney reads.
 */
export interface SignatureRequestSummary {
  id: string
  name: string
  /** The matter_documents row this was made from, or null if it was deleted. */
  sourceDocumentId: string | null
  state: SignatureRequestState
  signedCount: number
  signerCount: number
  sentAt: string | null
  completedAt: string | null
  /** Why a send failed, recorded by the service. Null unless state is failed. */
  error: string | null
  signers: SignatureRequestSigner[]
}
