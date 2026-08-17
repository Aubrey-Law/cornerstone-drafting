import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  listCalendarView,
  mapGraphCalendarView,
  mapGraphEventTimes,
} from '@/lib/appointments/graphEvents'
import {
  reconcileAppointmentsFromOutlook,
  type ReconcilableAppointment,
} from '@/lib/appointments/outlookReconcile'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reading Outlook can take several Graph round-trips; the platform default is
// short enough that a slow mailbox would be killed mid-read and surface as
// "not connected".
export const maxDuration = 30

const MAX_RANGE_DAYS = 45
const DAY_MS = 86_400_000

/**
 * The attorney's Outlook events for a calendar range, across every calendar in
 * the mailbox, minus events that are Cornerstone appointments (those render
 * from the appointments table).
 *
 * This is also where the inbound half of the two-way sync runs: before the
 * overlay is built, moves and deletions made in Outlook are mirrored onto the
 * matching appointment rows, so the app never shows a booking at a time Outlook
 * has already abandoned.
 *
 * Outlook problems degrade to `connected: false` — the calendar still works.
 */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const params = req.nextUrl.searchParams
  const from = params.get('from') ? Date.parse(params.get('from')!) : NaN
  const to = params.get('to') ? Date.parse(params.get('to')!) : NaN
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
  }
  if (to - from > MAX_RANGE_DAYS * DAY_MS) {
    return NextResponse.json({ error: 'Date range too large' }, { status: 400 })
  }

  const fromIso = new Date(from).toISOString()
  const toIso = new Date(to).toISOString()

  // Cornerstone bookings in range: excluded from the overlay, and the rows the
  // inbound sync reconciles against Outlook.
  const { data } = await getAdminClient()
    .from('appointments')
    .select('id, start_time, end_time, status, microsoft_event_id')
    .gte('start_time', fromIso)
    .lt('start_time', toIso)
    .not('microsoft_event_id', 'is', null)
  const managed = (data ?? []) as ReconcilableAppointment[]
  const exclude = new Set(
    managed.map(row => row.microsoft_event_id).filter((id): id is string => Boolean(id)),
  )

  try {
    const view = await listCalendarView(fromIso, toIso)

    let synced = { moved: 0, cancelled: 0, failed: 0 }
    try {
      synced = await reconcileAppointmentsFromOutlook(managed, mapGraphEventTimes(view.raw))
    } catch (e) {
      // Reconciliation is best-effort; the overlay still renders without it.
      console.error('[appointments] outlook reconciliation failed', e)
    }

    return NextResponse.json({
      connected: true,
      events: mapGraphCalendarView(view.raw, exclude),
      calendars: view.calendars,
      truncated: view.truncated,
      skipped: view.skipped,
      synced,
    })
  } catch (e) {
    console.error('[appointments] outlook calendarView failed', e)
    return NextResponse.json({
      connected: false,
      events: [],
      calendars: [],
      truncated: false,
      skipped: [],
      synced: { moved: 0, cancelled: 0, failed: 0 },
      error: e instanceof Error ? e.message : 'Outlook is unreachable',
    })
  }
}
