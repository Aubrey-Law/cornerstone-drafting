import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, redirectToLogin } from '@/lib/apiAuth'
import { getAuthUrl, getGoogleConfigIssue } from '@/lib/googleCalendar'
import { getRequestOrigin } from '@/lib/requestOrigin'
import { beginOAuthState } from '@/lib/auth/oauthState'

export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err || !userId) {
    if (!err || err.status === 401) return redirectToLogin(req)
    return err
  }

  const configIssue = getGoogleConfigIssue()
  if (configIssue) {
    const url = new URL('/admin/settings', getRequestOrigin(req))
    url.searchParams.set('tab', 'google')
    url.searchParams.set('gcal_error', configIssue)
    return NextResponse.redirect(url)
  }

  const returnTo = req.nextUrl.searchParams.get('returnTo') || '/admin/settings?tab=google'
  // The callback stores tokens only for this browser and this staff user.
  const { state, withCookie } = beginOAuthState('google', userId, returnTo)
  return withCookie(NextResponse.redirect(getAuthUrl(state)))
}
