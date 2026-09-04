import { describe, expect, it, vi } from 'vitest'
// vi.mock is hoisted above this import.
import { GET, POST } from '@/app/auth/sign-out/route'

const signOut = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { signOut } }),
}))



describe('POST /auth/sign-out', () => {
  it('signs out and returns to the login page', async () => {
    const res = await POST(new Request('https://workbench.test/auth/sign-out', { method: 'POST' }))
    expect(signOut).toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/login')
  })
})

describe('GET /auth/sign-out', () => {
  /**
   * A sign-out on GET is triggered by any link, image or prefetch pointed at
   * it — including one on a page the firm does not control. Refusing the method
   * is what makes the POST form the only way to sign out.
   */
  it('is refused, so a link or a prefetch cannot sign the user out', async () => {
    const res = await GET()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })
})
