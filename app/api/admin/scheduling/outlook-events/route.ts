import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listCalendarView, mapGraphCalendarView } from '@/lib/appointments/graphEvents'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_RANGE_DAYS = 45
const DAY_MS = 86_400_000

/**
 * The attorney's Outlook events for a calendar range, minus events that are
 * Cornerstone appointments (those render from the appointments table).
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

  // Event ids of Cornerstone bookings in range → excluded from the overlay.
  const { data } = await getAdminClient()
    .from('appointments')
    .select('microsoft_event_id')
    .gte('start_time', fromIso)
    .lt('start_time', toIso)
    .not('microsoft_event_id', 'is', null)
  const exclude = new Set(
    ((data ?? []) as { microsoft_event_id: string | null }[])
      .map(r => r.microsoft_event_id)
      .filter((id): id is string => Boolean(id)),
  )

  try {
    const raw = await listCalendarView(fromIso, toIso)
    return NextResponse.json({
      connected: true,
      events: mapGraphCalendarView(raw, exclude),
    })
  } catch (e) {
    console.error('[appointments] outlook calendarView failed', e)
    return NextResponse.json({
      connected: false,
      events: [],
      error: e instanceof Error ? e.message : 'Outlook is unreachable',
    })
  }
}
