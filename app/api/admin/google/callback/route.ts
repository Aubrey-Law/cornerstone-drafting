import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exchangeCode, fetchAccountEmail, toGoogleDisplayError } from '@/lib/googleCalendar'
import { storeCalendarConnection } from '@/lib/calendarConnections'
import { getRequestOrigin } from '@/lib/requestOrigin'
import { safeAdminRedirectPath } from '@/lib/auth/safeRedirect'

interface CallbackState {
  token?: string | null
  returnTo?: string
}

function decodeState(state: string | null): CallbackState {
  if (!state) return {}
  try {
    const raw = Buffer.from(state, 'base64url').toString('utf-8')
    if (raw.startsWith('{')) return JSON.parse(raw) as CallbackState
    return { token: raw }
  } catch {
    return {}
  }
}

function redirectBack(req: NextRequest, returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo, getRequestOrigin(req))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')
  const state = decodeState(searchParams.get('state'))
  // `state` is unsigned, attacker-suppliable input and the error branches below
  // redirect before any session check, so an unvalidated returnTo is an
  // unauthenticated open redirect on the firm's own domain.
  const returnTo = safeAdminRedirectPath(state.returnTo) ?? '/admin/settings?tab=google'

  if (error) {
    return redirectBack(req, returnTo, {
      gcal_error: toGoogleDisplayError(errorDesc || error),
    })
  }
  if (!code) {
    return redirectBack(req, returnTo, { gcal_error: 'no_code' })
  }

  let user: { email?: string | null; id: string } | null = null
  if (state.token) {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${state.token}` } } },
    )
    user = (await sb.auth.getUser()).data.user
  } else {
    const { createServerSupabase } = await import('@/lib/supabaseServer')
    const sb = await createServerSupabase()
    user = (await sb.auth.getUser()).data.user
  }

  if (!user) {
    return redirectBack(req, returnTo, { gcal_error: 'forbidden' })
  }

  const { getAdminClient } = await import('@/lib/supabaseAdmin')
  const { data: profile } = await getAdminClient()
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !['admin', 'attorney'].includes(profile.role as string)) {
    return redirectBack(req, returnTo, { gcal_error: 'forbidden' })
  }

  try {
    const tokens = await exchangeCode(code)
    if (!tokens.access_token) throw new Error('No access token returned')

    // No refresh token means this connection dies at the first expiry with no
    // way to renew it, and it would look healthy until then. Google omits one
    // when consent was previously granted without `prompt=consent`; say so
    // rather than storing a connection that is already broken.
    if (!tokens.refresh_token) {
      return redirectBack(req, returnTo, {
        gcal_error:
          'Google returned no refresh token, so the connection would stop working within the hour. Remove Cornerstone at myaccount.google.com/permissions and connect again.',
      })
    }

    const expires_at = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString()
    const accountEmail = await fetchAccountEmail(tokens.access_token)

    await storeCalendarConnection({
      userId: user.id,
      provider: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at,
      email: accountEmail,
      scopes: tokens.scope ?? null,
    })

    return redirectBack(req, returnTo, { gcal_connected: '1' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return redirectBack(req, returnTo, { gcal_error: toGoogleDisplayError(msg) })
  }
}
