import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/lawmatics'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createServerSupabase } from '@/lib/supabaseServer'

const STATE_COOKIE = 'lawmatics_oauth_state'

function clearStateCookie(res: NextResponse) {
  res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

function stateMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error) {
    return clearStateCookie(NextResponse.redirect(
      new URL(`/admin/matters?lm_error=${encodeURIComponent(error)}`, req.nextUrl.origin),
    ))
  }

  if (!code) {
    return clearStateCookie(NextResponse.redirect(
      new URL('/admin/matters?lm_error=no_code', req.nextUrl.origin),
    ))
  }

  const expectedState = req.cookies.get(STATE_COOKIE)?.value
  if (!state || !expectedState || !stateMatches(state, expectedState)) {
    return clearStateCookie(NextResponse.redirect(
      new URL('/admin/matters?lm_error=invalid_state', req.nextUrl.origin),
    ))
  }

  try {
    const sb = await createServerSupabase()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      return clearStateCookie(NextResponse.redirect(
        new URL('/admin/matters?lm_error=forbidden', req.nextUrl.origin),
      ))
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const isAdmin = Boolean(profile && ['attorney', 'admin'].includes(profile.role))
    if (!isAdmin) {
      return clearStateCookie(NextResponse.redirect(
        new URL('/admin/matters?lm_error=forbidden', req.nextUrl.origin),
      ))
    }

    const tokens = await exchangeCode(code)
    const expires_at = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

    const { error: dbError } = await admin.from('lawmatics_tokens').upsert({
      id: 'singleton',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at,
      updated_at: new Date().toISOString(),
    })
    if (dbError) throw new Error(dbError.message)

    return clearStateCookie(NextResponse.redirect(
      new URL('/admin/matters?lm_connected=1', req.nextUrl.origin),
    ))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return clearStateCookie(NextResponse.redirect(
      new URL(`/admin/matters?lm_error=${encodeURIComponent(msg)}`, req.nextUrl.origin),
    ))
  }
}
