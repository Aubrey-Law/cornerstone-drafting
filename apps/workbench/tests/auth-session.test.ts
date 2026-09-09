import { describe, expect, it } from 'vitest'
import { resolveRole, resolveSession } from '@/lib/auth/session'

/**
 * The session resolver takes a structural client rather than a Supabase
 * instance, so these tests exercise the real branching with plain objects —
 * the same injection idiom the drafting engine uses for its clause client.
 */
const authReturning = (claims: Record<string, unknown> | null) => ({
  auth: {
    getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
  },
})

describe('resolveSession', () => {
  it('reads the user id and role claim from a live session', async () => {
    const result = await resolveSession(authReturning({ sub: 'u-1', user_role: 'attorney' }))
    expect(result).toEqual({ ok: true, userId: 'u-1', claimRole: 'attorney' })
  })

  it('reports an anonymous request as a successful read with no user', async () => {
    expect(await resolveSession(authReturning(null))).toEqual({ ok: true, userId: null, claimRole: null })
  })

  it('reports no role claim when the JWT hook is not enabled', async () => {
    const result = await resolveSession(authReturning({ sub: 'u-1' }))
    expect(result).toEqual({ ok: true, userId: 'u-1', claimRole: null })
  })

  /**
   * The decision that matters: an unreachable auth backend is not an anonymous
   * request. Reading a thrown error as "no session" would send every signed-in
   * request to the login page during an outage; reading it as "no gate" would
   * serve client files to anyone. It fails closed instead, and the caller
   * answers 503.
   */
  it('fails closed when the auth call throws', async () => {
    const result = await resolveSession({
      auth: {
        getClaims: async () => {
          throw new Error('fetch failed')
        },
      },
    })
    expect(result).toEqual({ ok: false })
  })

  it('fails closed when the auth call reports an error', async () => {
    const result = await resolveSession({
      auth: {
        getClaims: async () => ({ data: null, error: { message: 'service unavailable' } }),
      },
    })
    expect(result).toEqual({ ok: false })
  })

  /**
   * The other half of that decision, and the one it took an outage-shaped bug
   * to notice: a token the backend *answered about* is not an outage.
   *
   * When Supabase says `bad_jwt`, it was reachable, it read the token, and it
   * told us the token is unusable. Treating that as "the backend is down"
   * answers 503 — and the login page is behind the same gate, so the holder of
   * a stale cookie cannot reach the page that would replace it. They are locked
   * out until they clear cookies by hand, and nothing on screen suggests that.
   *
   * Reproduced against the deployed workbench on 2026-09-09: a JWT whose `kid`
   * is not in the project's JWKS returned 503 from `/auth/login` itself. That
   * is what a token signed before the project rotated to its ES256 key looks
   * like.
   *
   * Both error shapes below are copied from a real `getClaims()` call against
   * the live project, not invented.
   */
  const errorReturning = (error: { message: string; code?: string; status?: number }) => ({
    auth: { getClaims: async () => ({ data: null, error }) },
  })

  it('treats a token signed by a rotated key as anonymous, not as an outage', async () => {
    const result = await resolveSession(
      errorReturning({
        name: 'AuthApiError',
        status: 403,
        code: 'bad_jwt',
        message:
          'invalid JWT: unable to parse or verify signature, token is unverifiable: error while executing keyfunc: unrecognized JWT kid dead-beef for algorithm ES256',
      } as { message: string; code?: string; status?: number }),
    )
    expect(result).toEqual({ ok: true, userId: null, claimRole: null })
  })

  /**
   * Unlike every other case here, this one is **constructed, not measured**.
   * Probing the live project on 2026-09-09 returned `bad_jwt` for a non-JWT
   * string as well, so `invalid_jwt` was never observed from this project. It
   * is a documented Supabase code meaning the same thing, carried as a cheap
   * superset — and this comment is here so nobody later reads the test as
   * proof that the project emits it.
   */
  it('treats a structurally invalid token as anonymous', async () => {
    const result = await resolveSession(
      errorReturning({ status: 400, code: 'invalid_jwt', message: 'Invalid JWT structure' }),
    )
    expect(result).toEqual({ ok: true, userId: null, claimRole: null })
  })

  /**
   * The guard on the guard. Widening "bad token" must not swallow the outage
   * case it was carved out of, so anything the backend did not answer about —
   * a 5xx, a retryable fetch failure, an error with no code at all — still
   * fails closed.
   */
  it('still fails closed on a 5xx, which is the backend failing rather than judging', async () => {
    const result = await resolveSession(
      errorReturning({ status: 503, code: 'service_unavailable', message: 'upstream is down' }),
    )
    expect(result).toEqual({ ok: false })
  })

  it('still fails closed on a retryable fetch failure', async () => {
    const result = await resolveSession(
      errorReturning({ status: 0, code: undefined, message: 'Failed to fetch' }),
    )
    expect(result).toEqual({ ok: false })
  })

  it('still fails closed on a 4xx that is not about the token', async () => {
    // A 4xx alone is not the signal — only one that names the token is. An
    // unrecognised 4xx could be a misconfigured key or a rate limit, neither of
    // which is a reason to sign a user out.
    const result = await resolveSession(
      errorReturning({ status: 429, code: 'over_request_rate_limit', message: 'slow down' }),
    )
    expect(result).toEqual({ ok: false })
  })
})

describe('resolveRole', () => {
  it('trusts the JWT claim without reading anything', async () => {
    const reader = () => {
      throw new Error('should not read when the claim is present')
    }
    expect(await resolveRole(reader, 'u-1', 'attorney')).toBe('attorney')
  })

  it('falls back to the reader when the claim is absent', async () => {
    // Sessions issued before the custom access-token hook was enabled carry no
    // user_role claim; without this fallback every one of them reads as roleless.
    const seen: string[] = []
    const reader = async (userId: string) => {
      seen.push(userId)
      return 'client'
    }
    expect(await resolveRole(reader, 'u-1', null)).toBe('client')
    expect(seen).toEqual(['u-1'])
  })

  it('reports no role when the reader finds none', async () => {
    expect(await resolveRole(async () => null, 'u-1', null)).toBeNull()
  })

  it('treats an empty claim as absent rather than as a role', async () => {
    expect(await resolveRole(async () => 'attorney', 'u-1', '')).toBe('attorney')
  })
})
