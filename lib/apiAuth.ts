import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabaseServer'
import { ensureUserProfile } from '@/lib/auth/ensureUserProfile'

const ADMIN_ROLES = ['attorney', 'admin'] as const

export type ApiAuthRole = (typeof ADMIN_ROLES)[number]

/** Bearer token from Authorization header (client fetch calls). */
export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7).trim() || null
}

export async function resolveUserRole(userId: string): Promise<string | null> {
  const admin = (await import('@/lib/supabaseAdmin')).getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  return profile?.role ?? null
}

/**
 * The caller's own Supabase client, scoped to their bearer token, alongside the
 * user it resolves to.
 *
 * The client is returned and not discarded because `ensure_user_profile` is
 * SECURITY DEFINER over `auth.uid()`: it has to be called as the user, and the
 * service-role client has no `auth.uid()` to read.
 */
async function clientFromBearer(token: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user } } = await sb.auth.getUser()
  return { sb, user }
}

/** Resolve an authenticated bearer user without imposing an admin role. */
export async function getBearerUser(req: Request) {
  const token = getBearerToken(req)
  return token ? (await clientFromBearer(token)).user : null
}

// Verifies the user against Supabase Auth (remote hop) AND checks role.
async function verifyAdmin(_req: Request) {
  const token = getBearerToken(_req)
  if (token) {
    const { sb, user } = await clientFromBearer(token)
    if (!user) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null, user: null }

    // A bearer caller may have no `public.users` row at all.
    //
    // The cookie path below cannot reach this state: `/auth/callback` and
    // `/auth/login` both run `ensureUserProfile` as part of signing in. The Word
    // add-in never touches either — its dialog talks to Supabase directly — so a
    // firm attorney signing in from Word arrived here authenticated, roleless,
    // and 403'd with nothing on screen explaining why. The documented
    // workaround was to go and open the web app once, which is no answer for an
    // add-in pushed to a machine.
    //
    // Bootstrapping here rather than in the add-in's own routes covers every
    // bearer caller, and cannot be used to self-elevate: `ensure_user_profile`
    // derives the role from the confirmed address on `auth.users`, so a
    // non-firm address still becomes 'client' and still fails the gate below.
    let role = await resolveUserRole(user.id)
    if (!role) role = await ensureUserProfile(sb, user)

    if (!role || !ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
      return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), userId: null, user: null }
    }

    return { err: null, userId: user.id, user }
  }

  const supabase = await createServerSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null, user: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role)) {
    return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), userId: null, user: null }
  }

  return { err: null, userId: user.id, user }
}

// Requests are weak keys: no token-keyed or process-wide user/role cache.
const adminRequests = new WeakMap<Request, ReturnType<typeof verifyAdmin>>()
export function requireAdmin(req: Request): ReturnType<typeof verifyAdmin> {
  let pending = adminRequests.get(req)
  if (!pending) {
    pending = verifyAdmin(req)
    adminRequests.set(req, pending)
  }
  return pending
}

/** Is this user an administrator? For gates outside an HTTP handler. */
export async function isAdministrator(userId: string): Promise<boolean> {
  return (await resolveUserRole(userId)) === 'admin'
}

/**
 * Gate for deleting a record outright, in the shape the delete routes want:
 * null when the caller may go ahead, the 403 response when they may not.
 * Archiving is open to every admin-role user; destroying is not.
 */
export async function requirePermanentDeletionRole(userId: string | null) {
  if (userId && (await isAdministrator(userId))) return null
  return NextResponse.json({ error: 'Permanent deletion requires an administrator' }, { status: 403 })
}

/** Strict administrator gate for destructive firm-wide settings. */
export async function requireAdministrator(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth

  const role = await resolveUserRole(auth.userId)
  if (role !== 'admin') {
    return {
      err: NextResponse.json({ error: 'Administrator role required' }, { status: 403 }),
      userId: null,
      user: null,
    }
  }
  return auth
}

/** Browser navigations — redirect to login instead of JSON 401. */
export function redirectToLogin(req: Request, nextPath?: string) {
  const login = new URL('/auth/login', req.url)
  const next = nextPath ?? new URL(req.url).pathname + new URL(req.url).search
  login.searchParams.set('redirectTo', next)
  return NextResponse.redirect(login)
}
