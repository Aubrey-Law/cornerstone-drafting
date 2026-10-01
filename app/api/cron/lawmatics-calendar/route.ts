import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { syncLawmaticsCalendar } from '@/lib/integrations/lawmatics/inbound'
import { runSystemAutomation } from '@/lib/automations/control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Pulls Lawmatics events onto the calendar. Lawmatics has no appointment
// webhook, so this run is what picks up reschedules and cancellations.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  const supplied = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ lawmatics: await syncLawmaticsCalendar() })
  } catch (error) {
    // Only aggregate counts are public; details go to the function log.
    console.error('[lawmatics-calendar] sync failed', error)
    return NextResponse.json({ error: 'Lawmatics calendar sync unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('lawmatics-calendar', req, () => handle(req), { leaseSeconds: 300 })
}
