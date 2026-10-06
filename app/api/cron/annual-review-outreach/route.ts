import { NextResponse } from 'next/server'
import { resolveUnattendedActor } from '@/lib/actions/delegation'
import { runSystemAutomation } from '@/lib/automations/control'
import { prepareAnnualReviewOutreach } from '@/lib/annualReview/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Each weekday morning: find the signed plans whose annual review is coming
 * due, draft the client's invitation, and offer each send through the
 * delegation dial. Off until the firm turns it on in Settings → Workflow.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // A cron run has no user. Delegated sends run as the firm's attorney, the
    // same person a manual approval would run as.
    const actorId = await resolveUnattendedActor().then(actor => actor?.id ?? null, () => null)
    const result = await prepareAnnualReviewOutreach({ actorId })
    return NextResponse.json(result, { status: result.unavailable ? 503 : 200 })
  } catch (error) {
    console.error('[annual review] outreach run failed', error)
    return NextResponse.json({ error: 'Annual review outreach unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('annual-review-outreach', req, () => handle(req), { leaseSeconds: 120 })
}
