import { NextResponse } from 'next/server'
import { runEmailTriageScan } from '@/lib/emailTriage/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cron/email-triage — scan the mailbox for client and lead mail waiting
// on a reply and pre-draft the most recent of them, so the triage page is warm
// before the attorney opens it. Invoked by the Vercel cron in vercel.json;
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
//
// Always 200 with counts, including on a partial run. The scan is bounded and
// idempotent — what it did not reach stays queued for the next pass — so a
// short run is a normal outcome rather than a failure to alert on.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await runEmailTriageScan({ trigger: 'cron' }))
}
