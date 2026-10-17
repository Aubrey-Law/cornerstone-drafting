import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, redirectToLogin } from '@/lib/apiAuth'
import { getMicrosoftAuthUrl, getMicrosoftConfigIssue } from '@/lib/microsoftTeams'
import { getRequestOrigin } from '@/lib/requestOrigin'
import { beginOAuthState } from '@/lib/auth/oauthState'

export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err || !userId) {
    if (!err || err.status === 401) return redirectToLogin(req)
    return err
  }

  const configIssue = getMicrosoftConfigIssue()
  if (configIssue) {
    const url = new URL('/admin/settings', getRequestOrigin(req))
    url.searchParams.set('tab', 'google')
    url.searchParams.set('msteams_error', configIssue)
    return NextResponse.redirect(url)
  }

  const returnTo = req.nextUrl.searchParams.get('returnTo') || '/admin/settings?tab=google'
  // The callback stores tokens only for this browser and this staff user.
  const { state, withCookie } = beginOAuthState('microsoft', userId, returnTo)
  return withCookie(NextResponse.redirect(getMicrosoftAuthUrl(state)))
}
