import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getStoredCalendarConnection, deleteCalendarConnection } from '@/lib/calendarConnections'
import {
  getGoogleConfigIssue,
  hasCalendarScope,
  hasGmailSendScope,
  isGoogleConfigured,
} from '@/lib/googleCalendar'

export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const conn = userId ? await getStoredCalendarConnection(userId, 'google') : null

  return NextResponse.json({
    envConfigured: isGoogleConfigured(),
    configIssue: getGoogleConfigIssue(),
    connected: Boolean(conn),
    email: conn?.email ?? null,
    scopes: conn?.scopes ?? null,
    hasCalendarScope: hasCalendarScope(conn?.scopes),
    // One consent covers calendar and mail, so a connection made before Gmail
    // was wired in is connected for the calendar and silently unable to send.
    hasGmailSendScope: hasGmailSendScope(conn?.scopes),
    // A connection with no refresh token works until the access token expires
    // and then fails silently, so it is worth surfacing as its own state rather
    // than letting it read as connected.
    canRefresh: Boolean(conn?.refresh_token),
  })
}

export async function DELETE(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteCalendarConnection(userId, 'google')
  return NextResponse.json({ ok: true })
}
