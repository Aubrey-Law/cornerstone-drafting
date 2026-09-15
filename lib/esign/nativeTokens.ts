import crypto from 'node:crypto'

/**
 * Signing-link tokens for the native e-signature provider.
 *
 * Deliberately the same shape as lib/appointments/manageTokens.ts and
 * lib/intakeInviteTokens.ts rather than a new scheme: 32 random bytes, only
 * the SHA-256 persisted, constant-time comparison, explicit expiry.
 *
 * A signing link carries the power to execute a fee agreement, so the raw
 * token exists exactly twice — in the email and in the recipient's URL bar.
 * It is never written to the database, never logged, and cannot be recovered
 * from a backup. Losing one means re-sending, which is the correct trade.
 */

export const SIGNING_TOKEN_TTL_DAYS = 30

export interface SigningToken {
  /** The secret. Goes in the emailed link and nowhere else. */
  token: string
  /** What the database stores. */
  tokenHash: string
  expiresAt: string
}

export function createSigningToken(
  now = new Date(),
  ttlDays = SIGNING_TOKEN_TTL_DAYS,
): SigningToken {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
  return { token, tokenHash: hashSigningToken(token), expiresAt }
}

export function hashSigningToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Compare a presented token against a stored hash in constant time.
 *
 * `timingSafeEqual` throws on a length mismatch, so both sides are hashed
 * first — that makes them both 64 hex characters regardless of what was
 * presented, and keeps a malformed token on the same code path as a wrong one.
 */
export function signingTokenMatches(presented: string, storedHash: string): boolean {
  if (!presented || !storedHash) return false
  const presentedHash = Buffer.from(hashSigningToken(presented), 'utf8')
  const expected = Buffer.from(storedHash, 'utf8')
  if (presentedHash.length !== expected.length) return false
  return crypto.timingSafeEqual(presentedHash, expected)
}

export function isSigningTokenExpired(
  expiresAt: string | null | undefined,
  now = new Date(),
): boolean {
  // An unreadable or absent expiry counts as expired. The alternative — treat
  // it as "no expiry" — turns a data problem into a link that works forever.
  if (!expiresAt) return true
  const expires = Date.parse(expiresAt)
  return !Number.isFinite(expires) || expires <= now.getTime()
}

/** Statuses where a session can still be acted on by its signer. */
const OPEN_STATUSES = new Set(['sent', 'viewed'])

export type SigningSessionGate =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'already_signed' | 'declined' | 'closed' }

/**
 * Whether a signing session may still be used, given its stored state.
 *
 * Separated from the route so the precedence is testable, and the order is
 * deliberate: a completed outcome outranks expiry. Someone who signed and
 * comes back a month later should be told they already signed, not that their
 * link expired — the second is technically true and actively misleading. Only
 * a session with no outcome is judged on its expiry.
 */
export function signingSessionGate(
  session: { status: string; expires_at: string | null },
  now = new Date(),
): SigningSessionGate {
  if (session.status === 'signed') return { ok: false, reason: 'already_signed' }
  if (session.status === 'declined') return { ok: false, reason: 'declined' }
  if (isSigningTokenExpired(session.expires_at, now)) return { ok: false, reason: 'expired' }
  if (!OPEN_STATUSES.has(session.status)) return { ok: false, reason: 'closed' }
  return { ok: true }
}
