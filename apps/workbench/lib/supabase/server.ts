import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from './database'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { resolveRole, resolveSession } from '@/lib/auth/session'
import { readUserRole } from './roles'

/**
 * The cookie-backed server client, for Server Components, Server Actions and
 * route handlers. Subject to row-level security as the signed-in user, which is
 * the point — reach for the admin client only when a query genuinely has to see
 * past it.
 */
export async function createServerSupabase(): Promise<SupabaseClient<WorkbenchDatabase>> {
  const cookieStore = await cookies()

  return createServerClient<WorkbenchDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Server Components render in a read-only cookie context. Safe to
            // ignore: the proxy is what refreshes the session cookie.
          }
        },
      },
    },
  )
}

export type SessionUser = {
  id: string
  email: string | null
  role: string | null
}

/**
 * Who is signed in, resolved once per request.
 *
 * Returns null for an anonymous request and for a session whose role cannot be
 * determined — a page that renders for a roleless user would be showing a
 * surface nobody is authorized for. The proxy has already denied such requests
 * on gated paths; this is the second line, for anything it does not match.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createServerSupabase()
  const session = await resolveSession(supabase)
  if (!session.ok || !session.userId) return null

  const role = await resolveRole((id) => readUserRole(supabase, id), session.userId, session.claimRole)
  if (!role) return null

  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null
  return { id: session.userId, email, role }
})
