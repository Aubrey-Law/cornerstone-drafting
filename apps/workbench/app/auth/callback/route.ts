import { homeForRole, safeRedirectForRole } from '@/lib/auth/gate'
import { ensureProfileForUser } from '@/lib/supabase/profile'
import { isFirmEmail } from '@/lib/auth/firmEmail'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Where a Google sign-in lands.
 *
 * Every redirect below is a bare path rather than an absolute URL. On Vercel
 * the host a route handler sees is not always the host the browser asked for,
 * so building an absolute redirect means either trusting a forwarded header —
 * which is a way to send a freshly signed-in user to someone else's origin — or
 * sending them to an internal hostname. A relative `Location` is resolved by
 * the browser against the URL it actually requested, so there is no host to
 * get wrong.
 *
 * 303 so the browser follows with GET.
 */
function to(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } })
}

const refuse = (reason: 'auth_failed' | 'firm_domain_required' | 'no_role') =>
  to(`/auth/login?error=${reason}`)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  if (!code) return refuse('auth_failed')

  const supabase = await createServerSupabase()

  let user: { id: string; email: string | null; user_metadata?: Record<string, unknown> } | null
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error || !data?.user) return refuse('auth_failed')
    user = data.user as typeof user
  } catch {
    // A stale or replayed code, or Supabase unreachable. Either way this is
    // not a sign-in, and saying so beats a 500.
    return refuse('auth_failed')
  }
  if (!user) return refuse('auth_failed')

  const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null
  const role = await ensureProfileForUser(supabase, { id: user.id, fullName })

  /**
   * The consequential check. `ensure_user_profile` gives any address outside
   * the firm a client role, so without this a stranger with any Google account
   * signs in and provisions themselves a portal account. There are no client
   * users yet, so refusing costs nothing and closes a real exposure. Client
   * access will arrive as an invitation tied to an intake, not as an open
   * sign-up — and when it does, this is the check to revisit.
   *
   * An account with no email is refused for the same reason: there is nothing
   * to check it against.
   */
  if (!isFirmEmail(user.email)) {
    await supabase.auth.signOut()
    return refuse('firm_domain_required')
  }

  if (!role) {
    await supabase.auth.signOut()
    return refuse('no_role')
  }

  const home = homeForRole(role)
  if (!home) {
    await supabase.auth.signOut()
    return refuse('no_role')
  }

  return to(safeRedirectForRole(searchParams.get('redirectTo'), role) ?? home)
}
