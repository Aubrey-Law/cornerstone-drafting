import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getStoredCalendarConnection, deleteCalendarConnection } from '@/lib/calendarConnections'
import { getMicrosoftConfigIssue, isMicrosoftConfigured } from '@/lib/microsoftCalendar'

export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const configured = isMicrosoftConfigured()
  const configIssue = getMicrosoftConfigIssue()
  const conn = userId ? await getStoredCalendarConnection(userId, 'microsoft') : null

  return NextResponse.json({
    envConfigured: configured,
    configIssue,
    connected: Boolean(conn),
    email: conn?.email ?? null,
    scopes: conn?.scopes ?? null,
  })
}

export async function DELETE(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteCalendarConnection(userId, 'microsoft')
  return NextResponse.json({ ok: true })
}
