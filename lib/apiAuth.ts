import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabaseServer'

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

async function userFromBearer(token: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user } } = await sb.auth.getUser()
  return user
}

/** Resolve an authenticated bearer user without imposing an admin role. */
export async function getBearerUser(req: Request) {
  const token = getBearerToken(req)
  return token ? userFromBearer(token) : null
}

// Verifies the user against Supabase Auth (remote hop) AND checks role.
async function verifyAdmin(_req: Request) {
  const token = getBearerToken(_req)
  if (token) {
    const user = await userFromBearer(token)
    if (!user) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null, user: null }

    const role = await resolveUserRole(user.id)
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
