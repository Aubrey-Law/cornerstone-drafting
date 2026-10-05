import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { deleteCalendarConnection } from '@/lib/calendarConnections'
import {
  getMicrosoftConfigIssue,
  getMicrosoftConnection,
  hasTeamsScope,
  hasTranscriptScope,
  isMicrosoftConfigured,
} from '@/lib/microsoftTeams'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Whether Teams meetings can be created. The connection is firm-wide (as the
 * Google one is), so any staff member sees the attorney's connection.
 */
export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const conn = await getMicrosoftConnection(userId ?? null)
  return NextResponse.json({
    envConfigured: isMicrosoftConfigured(),
    configIssue: getMicrosoftConfigIssue(),
    connected: Boolean(conn),
    email: conn?.email ?? null,
    hasTeamsScope: hasTeamsScope(conn?.scopes),
    hasTranscriptScope: hasTranscriptScope(conn?.scopes),
    canRefresh: Boolean(conn?.refresh_token),
    ownConnection: Boolean(conn && conn.user_id === userId),
  })
}

export async function DELETE(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteCalendarConnection(userId, 'microsoft')
  return NextResponse.json({ ok: true })
}
