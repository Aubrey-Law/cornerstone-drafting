import { describe, expect, it, vi } from 'vitest'

/**
 * These clients are imported by modules that Next evaluates at build time, so
 * none of them may construct a client — or throw — on import. The root app
 * carries the same rule as a comment; here it is a test.
 */
describe('Supabase client modules', () => {
  it('import cleanly with no environment set', async () => {
    vi.resetModules()
    const saved = { ...process.env }
    for (const name of Object.keys(process.env)) {
      if (name.includes('SUPABASE')) delete process.env[name]
    }
    try {
      await expect(import('@/lib/supabase/admin')).resolves.toBeTruthy()
      await expect(import('@/lib/supabase/browser')).resolves.toBeTruthy()
      await expect(import('@/lib/supabase/server')).resolves.toBeTruthy()
    } finally {
      process.env = saved
      vi.resetModules()
    }
  })

  it('names the missing variable when the service-role client is used without one', async () => {
    vi.resetModules()
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    try {
      const { getAdminClient } = await import('@/lib/supabase/admin')
      // A client built from `undefined!` fails later, deep inside a query, as
      // an opaque fetch error. Refusing up front names the cause.
      expect(() => getAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
    } finally {
      if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl
      vi.resetModules()
    }
  })

  it('reuses one service-role client across calls', async () => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const { getAdminClient } = await import('@/lib/supabase/admin')
    expect(getAdminClient()).toBe(getAdminClient())
    vi.resetModules()
  })
})

describe('readUserRole', () => {
  const client = (row: { role: string | null } | null, error?: { message: string }) =>
    ({
      from: (table: string) => {
        expect(table).toBe('users')
        return {
          select: (columns: string) => {
            expect(columns).toBe('role')
            return {
              eq: (column: string, value: string) => {
                expect([column, value]).toEqual(['id', 'u-1'])
                return { maybeSingle: async () => ({ data: row, error: error ?? null }) }
              },
            }
          },
        }
      },
      // The narrow shape above is all this function touches.
    }) as never

  it('reads the role off the profile row', async () => {
    const { readUserRole } = await import('@/lib/supabase/roles')
    expect(await readUserRole(client({ role: 'attorney' }), 'u-1')).toBe('attorney')
  })

  it('reports null when there is no profile row', async () => {
    const { readUserRole } = await import('@/lib/supabase/roles')
    expect(await readUserRole(client(null), 'u-1')).toBeNull()
  })

  /**
   * The caller is deciding whether to admit a request, and "role unknown" is
   * the answer that denies. Throwing would turn a refusal into a 500.
   */
  it('reports null rather than throwing when the query fails', async () => {
    const { readUserRole } = await import('@/lib/supabase/roles')
    expect(await readUserRole(client(null, { message: 'boom' }), 'u-1')).toBeNull()
  })
})
