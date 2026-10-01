import { NextRequest, NextResponse } from 'next/server'
import { storeCalendarConnection } from '@/lib/calendarConnections'
import {
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
  toMicrosoftDisplayError,
} from '@/lib/microsoftTeams'
import { getRequestOrigin } from '@/lib/requestOrigin'
import { safeAdminRedirectPath } from '@/lib/auth/safeRedirect'

function decodeReturnTo(state: string | null): string | undefined {
  if (!state) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { returnTo?: unknown }
    return typeof parsed.returnTo === 'string' ? parsed.returnTo : undefined
  } catch {
    return undefined
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
  // `state` is unsigned and the error branches redirect before any session
  // check, so returnTo is validated to keep this from being an open redirect.
  const returnTo = safeAdminRedirectPath(decodeReturnTo(searchParams.get('state'))) ?? '/admin/settings?tab=google'

  if (error) {
    return redirectBack(req, returnTo, { msteams_error: toMicrosoftDisplayError(errorDesc || error) })
  }
  if (!code) return redirectBack(req, returnTo, { msteams_error: 'no_code' })

  // The browser arrives here from Microsoft carrying the staff session cookie.
  const { createServerSupabase } = await import('@/lib/supabaseServer')
  const sb = await createServerSupabase()
  const user = (await sb.auth.getUser()).data.user
  if (!user) return redirectBack(req, returnTo, { msteams_error: 'forbidden' })

  const { getAdminClient } = await import('@/lib/supabaseAdmin')
  const { data: profile } = await getAdminClient()
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['admin', 'attorney'].includes(profile.role as string)) {
    return redirectBack(req, returnTo, { msteams_error: 'forbidden' })
  }

  try {
    const tokens = await exchangeMicrosoftCode(code)
    if (!tokens.access_token) throw new Error('No access token returned')
    if (!tokens.refresh_token) {
      return redirectBack(req, returnTo, {
        msteams_error:
          'Microsoft returned no refresh token, so the connection would stop working within the hour. Check that offline_access is allowed for the app registration and connect again.',
      })
    }

    await storeCalendarConnection({
      userId: user.id,
      provider: 'microsoft',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString(),
      email: await fetchMicrosoftAccountEmail(tokens.access_token),
      scopes: tokens.scope ?? null,
    })
    return redirectBack(req, returnTo, { msteams_connected: '1' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return redirectBack(req, returnTo, { msteams_error: toMicrosoftDisplayError(msg) })
  }
}
