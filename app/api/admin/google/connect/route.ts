import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, redirectToLogin } from '@/lib/apiAuth'
import { getAuthUrl, getGoogleConfigIssue } from '@/lib/googleCalendar'
import { getRequestOrigin } from '@/lib/requestOrigin'

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) {
    if (err.status === 401) return redirectToLogin(req)
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
  const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url')
  return NextResponse.redirect(getAuthUrl(state))
}
