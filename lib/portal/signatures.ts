import type { SigningSubjectKind } from '@/lib/esign/subject'

/**
 * Signing from the portal: the pure half.
 *
 * A signing session is sent to one named recipient at one email address, and
 * the emailed token is that recipient's credential. A client signed in to the
 * portal has a second credential, their account, and may sign the sessions
 * addressed to their own email without the token. These rules say which
 * sessions those are and how they are described; the server half
 * (signaturesServer.ts) reads them.
 */

export interface PortalSignature {
  sessionId: string
  kind: SigningSubjectKind
  /** "engagement agreement", or the document's name. */
  label: string
  /** The session's own state: still open to its signer. */
  status: 'sent' | 'viewed'
  recipientName: string
  recipientEmail: string
  /** Addressed to the signed-in client, so they can sign it here. */
  mine: boolean
  sentAt: string | null
  expiresAt: string
}

/** Session statuses a signer can still act on. Mirrors nativeTokens.OPEN_STATUSES. */
export const OPEN_SIGNING_STATUSES = ['sent', 'viewed'] as const

/** Parent statuses in which a request or agreement may still hold live sessions. */
export const LIVE_PARENT_STATUSES = ['sending', 'sent', 'viewed', 'partially_signed'] as const

export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** Whether a session addressed to `recipientEmail` belongs to the signed-in client. */
export function isSignerEmail(recipientEmail: string | null | undefined, userEmail: string | null | undefined): boolean {
  const recipient = normaliseEmail(recipientEmail)
  const user = normaliseEmail(userEmail)
  return recipient.length > 0 && recipient === user
}

/** The portal page for signing a session. */
export function portalSigningHref(sessionId: string): string {
  return `/documents/sign/${encodeURIComponent(sessionId)}`
}

/** "Your engagement agreement" / "HIPAA Authorization", as a heading. */
export function signatureTitle(signature: Pick<PortalSignature, 'kind' | 'label'>): string {
  if (signature.kind === 'engagement') return 'Your engagement agreement'
  return signature.label.trim() || 'Document to sign'
}

/** The noun the buttons use: "Sign agreement" / "Sign document". */
export function signatureNoun(kind: SigningSubjectKind): 'agreement' | 'document' {
  return kind === 'engagement' ? 'agreement' : 'document'
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

/** One line under each item: who it waits on, or how long the client has. */
export function signatureStatusLine(signature: PortalSignature, now = new Date()): string {
  if (!signature.mine) return `Waiting for ${signature.recipientName || signature.recipientEmail} to sign.`
  const expires = Date.parse(signature.expiresAt)
  const remaining = Number.isFinite(expires) ? expires - now.getTime() : null
  const sent = signature.sentAt ? `Sent ${SHORT_DATE.format(new Date(signature.sentAt))}` : 'Ready for you'
  if (remaining === null) return `${sent}.`
  if (remaining <= 0) return `${sent} · the link has expired; ask us for a new one.`
  const days = Math.floor(remaining / 86_400_000)
  if (days === 0) return `${sent} · available until later today.`
  if (days === 1) return `${sent} · available until tomorrow.`
  return `${sent} · available for ${days} more days.`
}

export interface PendingSignatureSummary {
  /** Sessions the signed-in client can sign here. */
  mine: PortalSignature[]
  /** Sessions on the same matter that wait on someone else (a spouse, usually). */
  others: PortalSignature[]
  /** Where "Review and sign" should go: the one item, or the list. */
  href: string
}

/** Split a matter's open sessions into the client's own and everyone else's, own first. */
export function summarisePendingSignatures(signatures: readonly PortalSignature[]): PendingSignatureSummary {
  const mine = signatures.filter(signature => signature.mine)
  const others = signatures.filter(signature => !signature.mine)
  return {
    mine,
    others,
    href: mine.length === 1 ? portalSigningHref(mine[0].sessionId) : '/documents#sign',
  }
}
