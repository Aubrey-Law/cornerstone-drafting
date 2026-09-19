import { describe, expect, it } from 'vitest'
import {
  createSigningToken,
  hashSigningToken,
  isSigningTokenExpired,
  signingSessionGate,
  signingTokenMatches,
  SIGNING_TOKEN_TTL_DAYS,
} from '@/lib/esign/nativeTokens'

/**
 * A signing link carries the power to execute a fee agreement, so the property
 * that matters most is negative: the raw token must never be recoverable from
 * anything the system keeps.
 */

describe('createSigningToken', () => {
  it('never returns the raw token in the field meant for storage', () => {
    const { token, tokenHash } = createSigningToken()

    expect(tokenHash).not.toContain(token)
    expect(tokenHash).toBe(hashSigningToken(token))
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces unguessable, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createSigningToken().token))

    expect(tokens.size).toBe(200)
    // 32 random bytes in base64url.
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(43)
  })

  it('sets the expiry from the documented TTL', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const { expiresAt } = createSigningToken(now)

    expect(expiresAt).toBe(
      new Date(now.getTime() + SIGNING_TOKEN_TTL_DAYS * 86_400_000).toISOString(),
    )
  })
})

describe('signingTokenMatches', () => {
  it('accepts the real token and rejects everything else', () => {
    const { token, tokenHash } = createSigningToken()

    expect(signingTokenMatches(token, tokenHash)).toBe(true)
    expect(signingTokenMatches(`${token}x`, tokenHash)).toBe(false)
    expect(signingTokenMatches(token.slice(0, -1), tokenHash)).toBe(false)
    expect(signingTokenMatches(createSigningToken().token, tokenHash)).toBe(false)
  })

  it('rejects empty values rather than treating them as a match', () => {
    const { token, tokenHash } = createSigningToken()

    expect(signingTokenMatches('', tokenHash)).toBe(false)
    expect(signingTokenMatches(token, '')).toBe(false)
    expect(signingTokenMatches('', '')).toBe(false)
  })

  it('does not throw on a malformed stored hash', () => {
    // timingSafeEqual throws on a length mismatch; hashing both sides first is
    // what keeps a corrupt row on the same path as a wrong token.
    const { token } = createSigningToken()

    expect(() => signingTokenMatches(token, 'not-a-sha256')).not.toThrow()
    expect(signingTokenMatches(token, 'not-a-sha256')).toBe(false)
  })
})

describe('isSigningTokenExpired', () => {
  const now = new Date('2026-06-01T12:00:00Z')

  it('treats a future expiry as live and a past one as expired', () => {
    expect(isSigningTokenExpired('2026-06-02T12:00:00Z', now)).toBe(false)
    expect(isSigningTokenExpired('2026-05-31T12:00:00Z', now)).toBe(true)
  })

  it('treats the exact expiry instant as expired', () => {
    expect(isSigningTokenExpired(now.toISOString(), now)).toBe(true)
  })

  it('treats a missing or unparseable expiry as expired', () => {
    // The alternative reading — "no expiry" — turns a data problem into a
    // signing link that works forever.
    expect(isSigningTokenExpired(null, now)).toBe(true)
    expect(isSigningTokenExpired(undefined, now)).toBe(true)
    expect(isSigningTokenExpired('whenever', now)).toBe(true)
    expect(isSigningTokenExpired('', now)).toBe(true)
  })
})

describe('signingSessionGate', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  const live = '2026-07-01T00:00:00Z'
  const past = '2026-05-01T00:00:00Z'

  it('opens a sent or viewed session that has not expired', () => {
    expect(signingSessionGate({ status: 'sent', expires_at: live }, now)).toEqual({ ok: true })
    expect(signingSessionGate({ status: 'viewed', expires_at: live }, now)).toEqual({ ok: true })
  })

  it('closes an unsigned session once it expires', () => {
    expect(signingSessionGate({ status: 'sent', expires_at: past }, now))
      .toEqual({ ok: false, reason: 'expired' })
  })

  it('reports an already-signed session as signed even after it expires', () => {
    // Telling someone who completed the signing that their link expired is
    // technically true and actively misleading.
    expect(signingSessionGate({ status: 'signed', expires_at: past }, now))
      .toEqual({ ok: false, reason: 'already_signed' })
  })

  it('reports a decline as a decline, not as expiry', () => {
    expect(signingSessionGate({ status: 'declined', expires_at: past }, now))
      .toEqual({ ok: false, reason: 'declined' })
  })

  it('reports a withdrawn session as cancelled, not as expiry', () => {
    // The firm took it back. Saying the link expired would be the same class of
    // lie as telling someone who already signed that their link lapsed — and
    // worse here, because the client did nothing and is being told the clock
    // ran out on them.
    expect(signingSessionGate({ status: 'cancelled', expires_at: live }, now))
      .toEqual({ ok: false, reason: 'cancelled' })
  })

  it('still reports a withdrawn session as cancelled once its date has passed', () => {
    // A cancelled request that also drifts past its expiry is withdrawn, not
    // expired. This is the ordering, and the only way to get it wrong is to
    // check expiry first.
    expect(signingSessionGate({ status: 'cancelled', expires_at: past }, now))
      .toEqual({ ok: false, reason: 'cancelled' })
  })

  it('closes a session in any other state', () => {
    expect(signingSessionGate({ status: 'expired', expires_at: live }, now))
      .toEqual({ ok: false, reason: 'closed' })
  })
})
