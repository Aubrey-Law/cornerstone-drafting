import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listAccountCalendars } from '@/lib/appointments/googleEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every calendar on the connected Google account.
 *
 * The calendar page learns its list from the events response; the settings
 * page has no such call and needs one to name the calendars the firm is
 * choosing between, and to spot a blocking id Google no longer serves.
 *
 * Degrades to `connected: false` rather than erroring, so a Google outage
 * leaves the scheduling settings editable.
 */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  try {
    return NextResponse.json({ connected: true, calendars: await listAccountCalendars() })
  } catch (e) {
    console.error('[appointments] could not list Google calendars', e)
    return NextResponse.json({
      connected: false,
      calendars: [],
      error: e instanceof Error ? e.message : 'Google Calendar is unreachable',
    })
  }
}
