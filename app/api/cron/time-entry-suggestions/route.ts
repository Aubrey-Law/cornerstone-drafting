import { NextResponse } from 'next/server'
import { resolveUnattendedActor } from '@/lib/actions/delegation'
import { runSystemAutomation } from '@/lib/automations/control'
import { prepareTimeEntrySuggestions } from '@/lib/timeEntries/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Each morning: read yesterday's matter activity and meetings and offer one
 * time entry per matter that had work and no time logged, through the
 * delegation dial. Pause it from the automation center.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // A cron run has no user. Delegated entries run as the firm's attorney, the
    // same person a manual approval would run as.
    const actorId = await resolveUnattendedActor().then(actor => actor?.id ?? null, () => null)
    const result = await prepareTimeEntrySuggestions({ actorId })
    return NextResponse.json(result, { status: result.unavailable ? 503 : 200 })
  } catch (error) {
    console.error('[time entries] suggestion run failed', error)
    return NextResponse.json({ error: 'Time entry suggestions unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('time-entry-suggestions', req, () => handle(req), { leaseSeconds: 120 })
}
