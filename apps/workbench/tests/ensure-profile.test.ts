import { describe, expect, it } from 'vitest'
import { ensureUserProfile, type ProfileStore } from '@/lib/auth/profile'

/**
 * A first Google sign-in has an auth identity and no `users` row, so it has no
 * role — and the gate denies a roleless session everywhere. This is the policy
 * that resolves it.
 *
 * The role is never chosen here. `createProfile` calls a SECURITY DEFINER
 * function that reads the verified address off `auth.users`, so a caller cannot
 * ask to be an attorney. The display name is the only influence a client has.
 */
const store = (over: {
  roles?: Array<string | null>
  created?: { ok: boolean; role: string | null }
  onCreate?: (fullName: string | null) => void
}): ProfileStore & { reads: () => number } => {
  const roles = [...(over.roles ?? [null])]
  let reads = 0
  return {
    reads: () => reads,
    readRole: async () => {
      reads += 1
      return roles.length > 1 ? (roles.shift() ?? null) : (roles[0] ?? null)
    },
    createProfile: async (fullName) => {
      over.onCreate?.(fullName)
      return over.created ?? { ok: true, role: null }
    },
  }
}

describe('ensureUserProfile', () => {
  it('returns an existing role without creating anything', async () => {
    const created: Array<string | null> = []
    const s = store({ roles: ['attorney'], onCreate: (n) => created.push(n) })
    expect(await ensureUserProfile(s, { fullName: null })).toBe('attorney')
    expect(created).toEqual([])
  })

  it('creates the profile when there is none, and returns the role the server chose', async () => {
    const s = store({ roles: [null], created: { ok: true, role: 'attorney' } })
    expect(await ensureUserProfile(s, { fullName: 'Scott Aubrey' })).toBe('attorney')
  })

  it('passes the display name from the identity provider', async () => {
    const seen: Array<string | null> = []
    const s = store({ roles: [null], created: { ok: true, role: 'client' }, onCreate: (n) => seen.push(n) })
    await ensureUserProfile(s, { fullName: 'Scott Aubrey' })
    expect(seen).toEqual(['Scott Aubrey'])
  })

  it('sends no display name when the provider gave none', async () => {
    const seen: Array<string | null> = []
    const s = store({ roles: [null], created: { ok: true, role: 'client' }, onCreate: (n) => seen.push(n) })
    await ensureUserProfile(s, { fullName: null })
    expect(seen).toEqual([null])
  })

  /**
   * Two callbacks racing a first sign-in both find no row and both insert; one
   * loses on the primary key. Re-reading turns that into the role that now
   * exists rather than a failed sign-in.
   */
  it('re-reads the role when creation loses a race', async () => {
    const s = store({ roles: [null, 'attorney'], created: { ok: false, role: null } })
    expect(await ensureUserProfile(s, { fullName: null })).toBe('attorney')
    expect(s.reads()).toBe(2)
  })

  it('returns null when no role could be established', async () => {
    const s = store({ roles: [null], created: { ok: true, role: null } })
    expect(await ensureUserProfile(s, { fullName: null })).toBeNull()
  })
})
