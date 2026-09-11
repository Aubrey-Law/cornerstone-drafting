import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getGoogleConnectionForUser, hasGmailModifyScope } from '@/lib/googleCalendar'
import {
  fetchEmailTriageQueue,
  fetchLastTriageScan,
  fetchTriageEnabled,
} from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

// GET /api/admin/email-triage — the queue, plus the connection state the page
// needs to explain an empty one. An empty queue and a missing scope look
// identical from the outside, so both are reported rather than left to guess.
export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const [rows, scan, enabled, conn] = await Promise.all([
    fetchEmailTriageQueue(),
    fetchLastTriageScan(),
    fetchTriageEnabled(),
    getGoogleConnectionForUser(userId),
  ])

  return NextResponse.json({
    rows,
    scan,
    enabled,
    connected: Boolean(conn),
    mailbox: conn?.email ?? null,
    hasGmailModifyScope: hasGmailModifyScope(conn?.scopes),
  })
}
