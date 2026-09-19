import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listCalendarView, mapCalendarView, mapEventTimes } from '@/lib/appointments/googleEvents'
import {
  reconcileAppointmentsFromCalendar,
  type ReconcilableAppointment,
} from '@/lib/appointments/calendarReconcile'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reading the account can take several round-trips across its calendars; the
// platform default is short enough that a slow read would be killed mid-flight
// and surface as "not connected".
export const maxDuration = 30

const MAX_RANGE_DAYS = 45
const DAY_MS = 86_400_000

/**
 * The attorney's Google Calendar events for a range, across every calendar on
 * the account, minus events that are Cornerstone appointments (those render
 * from the appointments table).
 *
 * This is also where the inbound half of the two-way sync runs: before the
 * overlay is built, moves and deletions made in Google Calendar are mirrored
 * onto the matching appointment rows, so the app never shows a booking at a
 * time the calendar has already abandoned.
 *
 * Calendar problems degrade to `connected: false` — the calendar page still
 * works.
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
  // inbound sync reconciles against the calendar.
  const { data } = await getAdminClient()
    .from('appointments')
    .select('id, start_time, end_time, status, google_event_id')
    .gte('start_time', fromIso)
    .lt('start_time', toIso)
    .not('google_event_id', 'is', null)
  const managed = (data ?? []) as ReconcilableAppointment[]
  const exclude = new Set(
    managed
      .map(row => row.google_event_id)
      .filter((id): id is string => Boolean(id)),
  )

  try {
    const view = await listCalendarView(fromIso, toIso)

    let synced = { moved: 0, cancelled: 0, failed: 0 }
    try {
      synced = await reconcileAppointmentsFromCalendar(managed, mapEventTimes(view.raw))
    } catch (e) {
      // Reconciliation is best-effort; the overlay still renders without it.
      console.error('[appointments] calendar reconciliation failed', e)
    }

    return NextResponse.json({
      connected: true,
      events: mapCalendarView(view.raw, exclude),
      calendars: view.calendars,
      truncated: view.truncated,
      skipped: view.skipped,
      synced,
    })
  } catch (e) {
    console.error('[appointments] Google calendar view failed', e)
    return NextResponse.json({
      connected: false,
      events: [],
      calendars: [],
      truncated: false,
      skipped: [],
      synced: { moved: 0, cancelled: 0, failed: 0 },
      error: e instanceof Error ? e.message : 'Google Calendar is unreachable',
    })
  }
}
