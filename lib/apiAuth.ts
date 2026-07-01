import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabase, getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'

const ADMIN_ROLES = ['attorney', 'admin'] as const
const FIRM_STAFF_ROLES = ['attorney', 'admin', 'va', 'staff'] as const

export type ApiAuthRole = (typeof ADMIN_ROLES)[number] | (typeof FIRM_STAFF_ROLES)[number]

/** Bearer token from Authorization header (VA dashboard fetch calls). */
export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7).trim() || null
}

async function resolveUserRole(userId: string): Promise<string | null> {
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

// Verifies the user against Supabase Auth (remote hop) AND checks role.
// Use for mutations and any flow where revocation must be caught immediately.
export async function requireAdmin(_req: Request) {
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

// Local-JWT-only fast path for safe GET endpoints. Verifies the JWT signature
// locally (no Supabase Auth round-trip) and uses the per-request-cached role
// lookup. Revocation is bounded by JWT TTL — do NOT use for mutations.
export async function requireAdminFast(_req: Request) {
  const claims = await getCachedClaims()
  if (!claims?.id) {
    return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null }
  }

  const role = await getCachedUserRole(claims.id)
  if (!role || !ADMIN_ROLES.includes(role)) {
    return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), userId: null }
  }

  return { err: null, userId: claims.id }
}

// Attorney/admin only. Accepts session cookies (admin UI) or Bearer token (fetch).
export async function requireFirmStaff(req: Request) {
  const token = getBearerToken(req)
  let userId: string | null = null

  if (token) {
    const user = await userFromBearer(token)
    if (!user) {
      return {
        err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        userId: null,
      }
    }
    userId = user.id
  } else {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return {
        err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        userId: null,
      }
    }
    userId = user.id
  }

  const role = await resolveUserRole(userId)
  if (!role || !FIRM_STAFF_ROLES.includes(role as (typeof FIRM_STAFF_ROLES)[number])) {
    return {
      err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      userId: null,
    }
  }

  return { err: null, userId }
}

/** Browser navigations (OAuth connect) — redirect to login instead of JSON 401. */
export function redirectToLogin(req: Request, nextPath?: string) {
  const login = new URL('/auth/login', req.url)
  const next = nextPath ?? new URL(req.url).pathname + new URL(req.url).search
  login.searchParams.set('next', next)
  return NextResponse.redirect(login)
}
