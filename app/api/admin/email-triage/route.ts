import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getGoogleConnectionForUser, hasGmailModifyScope } from '@/lib/googleCalendar'
import {
  fetchEmailTriageQueue,
  fetchLastTriageScan,
  fetchTriageArchiveNonClient,
  fetchTriageEnabled,
  type TriageQueueView,
} from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

const VIEWS: TriageQueueView[] = [
  'all', 'client', 'lead', 'contact', 'possible_lead',
  'overdue', 'needs_draft', 'drafted', 'failed', 'snoozed', 'follow_up', 'mine',
]

function parseView(value: string | null): TriageQueueView {
  return VIEWS.includes(value as TriageQueueView) ? (value as TriageQueueView) : 'all'
}

// GET /api/admin/email-triage — the queue, plus the connection state the page
// needs to explain an empty one. An empty queue and a missing scope look
// identical from the outside, so both are reported rather than left to guess.
export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const view = parseView(new URL(req.url).searchParams.get('view'))
  const [rows, scan, enabled, archiveNonClient, conn] = await Promise.all([
    fetchEmailTriageQueue({ view, claimedBy: userId }),
    fetchLastTriageScan(),
    fetchTriageEnabled(),
    fetchTriageArchiveNonClient(),
    getGoogleConnectionForUser(userId),
  ])

  return NextResponse.json({
    rows,
    scan,
    view,
    enabled,
    archiveNonClient,
    connected: Boolean(conn),
    mailbox: conn?.email ?? null,
    hasGmailModifyScope: hasGmailModifyScope(conn?.scopes),
    currentUserId: userId,
  })
}
