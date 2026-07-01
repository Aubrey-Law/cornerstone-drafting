import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { Database } from '@/types/supabase'

// Per-request cached auth claims. getClaims() verifies the JWT locally
// (no network round-trip), unlike getUser() which calls Supabase Auth.
// Use this anywhere you only need the authenticated user id / email.
export const getCachedClaims = cache(async () => {
  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) return null
  return {
    id: claims.sub as string,
    email: (claims.email as string | undefined) ?? null,
    role: ((claims as Record<string, unknown>).user_role as string | undefined) ?? null,
    claims,
  }
})

// Per-request cached role lookup. Prefers the `user_role` JWT claim populated
// by the custom_access_token_hook (no DB hit). Falls back to a `users` query
// for sessions issued before the hook was enabled.
export const getCachedUserRole = cache(async (userId: string) => {
  const claims = await getCachedClaims()
  if (claims?.id === userId && claims.role) return claims.role

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()
  return data?.role ?? null
})

export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll can fail in Server Components when called from a read-only context.
            // This is safe to ignore if middleware is refreshing the session.
          }
        },
      },
    }
  )
}
