import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, fetchAccountEmail, toGoogleDisplayError } from '@/lib/googleCalendar'
import { storeCalendarConnection } from '@/lib/calendarConnections'
import { getRequestOrigin } from '@/lib/requestOrigin'
import { safeAdminRedirectPath } from '@/lib/auth/safeRedirect'
import { clearOAuthState, stateReturnTo, verifyOAuthState } from '@/lib/auth/oauthState'

function redirectBack(req: NextRequest, returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo, getRequestOrigin(req))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return clearOAuthState(NextResponse.redirect(url), 'google')
}

const STATE_MISMATCH =
  'This connection request expired or was started in a different browser. Click Connect again.'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')
  const state = searchParams.get('state')
  // `state` is attacker-suppliable input and the error branches below redirect
  // before any session check, so an unvalidated returnTo is an unauthenticated
  // open redirect on the firm's own domain.
  const returnTo = safeAdminRedirectPath(stateReturnTo(state)) ?? '/admin/settings?tab=google'

  if (error) {
    return redirectBack(req, returnTo, {
      gcal_error: toGoogleDisplayError(errorDesc || error),
    })
  }
  if (!code) {
    return redirectBack(req, returnTo, { gcal_error: 'no_code' })
  }

  // Only the browser that started this connect, signed in as the same staff
  // user, may store the tokens. A bearer token is never accepted from `state`:
  // it is plain query text anyone can put on a consent URL.
  const startedBy = verifyOAuthState(req, 'google', state)
  if (!startedBy) {
    return redirectBack(req, returnTo, { gcal_error: STATE_MISMATCH })
  }

  const { createServerSupabase } = await import('@/lib/supabaseServer')
  const sb = await createServerSupabase()
  const user = (await sb.auth.getUser()).data.user

  if (!user || user.id !== startedBy) {
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
