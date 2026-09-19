import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIX = 'mc1'
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Double opt-in confirmation links.
 *
 * The token is stateless: it carries the address it was issued for and the time
 * it was issued, signed. There is no pending row to store, because the thing a
 * confirmation link proves is control of the mailbox, and possession of a link
 * we signed and sent to that address proves exactly that.
 *
 * The consequence worth stating: an unconfirmed request leaves no trace, so
 * nothing can measure how many people started and did not finish. That is an
 * acceptable loss for not holding a table of email addresses nobody has yet
 * given permission for — which would itself be a small pile of personal data
 * collected without consent.
 *
 * Same shape as lib/intake/standingLinks.ts, deliberately: prefix, base64url
 * payload, base64url HMAC, and a timing-safe compare.
 */

type ConsentPayload = {
  /** The normalized address this token was issued for. */
  e: string
  /** Issued-at, unix seconds. */
  t: number
  /** Where the request came from, recorded as consent_source on confirm. */
  s: string
}

const DEFAULT_SOURCE = 'website-optin'

/** Keep a source short, printable and free of anything that would need escaping. */
export function normalizeConsentSource(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SOURCE
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 60)
  return cleaned.length > 0 ? cleaned : DEFAULT_SOURCE
}

function signingSecret(): string {
  const configured = process.env.MARKETING_CONSENT_SIGNING_SECRET?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV !== 'production') return 'cornerstone-local-marketing-consent'
  throw new Error('MARKETING_CONSENT_SIGNING_SECRET is not configured')
}

function signature(encodedPayload: string): string {
  return createHmac('sha256', signingSecret())
    .update(`${PREFIX}.${encodedPayload}`, 'utf8')
    .digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Normalize an address the one way the whole flow agrees on.
 *
 * Mint and verify must agree exactly or the signature will not match, so this
 * is the only place either side is allowed to decide what an address looks
 * like. Returns null for anything that is not plausibly an address, which is
 * also the route's input validation.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0 || trimmed.length > 254) return null
  // Deliberately permissive: one @, something either side, no whitespace. The
  // authoritative test of an address is whether the confirmation email to it is
  // ever opened, and that happens two steps from here.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

export function createConsentToken(
  email: string,
  source: unknown = DEFAULT_SOURCE,
  nowMs: number = Date.now(),
): string {
  const normalized = normalizeEmail(email)
  if (!normalized) throw new Error('createConsentToken: invalid email')
  const payload: ConsentPayload = {
    e: normalized,
    t: Math.floor(nowMs / 1000),
    s: normalizeConsentSource(source),
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${PREFIX}.${encoded}.${signature(encoded)}`
}

export type ConsentTokenResult =
  | { ok: true; email: string; issuedAt: number; source: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

/**
 * Verify a confirmation token and return the address it was issued for.
 *
 * The reason is reported back so the route can tell someone whose link has
 * simply aged out to request a new one, rather than showing them the same
 * blank failure as a forged token.
 */
export function readConsentToken(
  token: unknown,
  options: { nowMs?: number; ttlSeconds?: number } = {},
): ConsentTokenResult {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' }

  const [prefix, encodedPayload, suppliedSignature, extra] = token.split('.')
  if (prefix !== PREFIX || !encodedPayload || !suppliedSignature || extra !== undefined) {
    return { ok: false, reason: 'malformed' }
  }
  // Signature before parse: never JSON.parse attacker-controlled bytes we have
  // not authenticated.
  if (!safeEqual(suppliedSignature, signature(encodedPayload))) {
    return { ok: false, reason: 'bad_signature' }
  }

  let parsed: Partial<ConsentPayload>
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<ConsentPayload>
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const email = normalizeEmail(parsed.e)
  if (!email || typeof parsed.t !== 'number' || !Number.isSafeInteger(parsed.t)) {
    return { ok: false, reason: 'malformed' }
  }
  // A token that re-encodes to a different address than it was signed for
  // cannot exist, but assert it rather than assume it: the signature covers the
  // encoded bytes, and this is what ties those bytes to the address we act on.
  if (email !== parsed.e) return { ok: false, reason: 'malformed' }

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000)
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
  // Both directions. A token issued in the future is not a clock problem we
  // should silently accept.
  if (parsed.t > nowSeconds + 60 || nowSeconds - parsed.t > ttl) {
    return { ok: false, reason: 'expired' }
  }

  // Signed, so it cannot have been edited in the link — but normalized again on
  // the way out so a token minted by an older version still lands in the shape
  // the column expects.
  return { ok: true, email, issuedAt: parsed.t, source: normalizeConsentSource(parsed.s) }
}
