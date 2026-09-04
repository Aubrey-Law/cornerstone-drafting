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
