import { NextResponse } from 'next/server'
import { resolveUnattendedActor } from '@/lib/actions/delegation'
import { runSystemAutomation } from '@/lib/automations/control'
import { prepareMercuryDepositMatching } from '@/lib/integrations/mercury/autoApplyServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Each morning: match the last two weeks of settled Mercury deposits to the
 * open invoices they pay and offer each payment through the delegation dial.
 * Does nothing when Mercury is not configured.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // A cron run has no user. Recorded payments run as the firm's attorney, the
    // same person a manual approval would run as.
    const actorId = await resolveUnattendedActor().then(actor => actor?.id ?? null, () => null)
    const result = await prepareMercuryDepositMatching({ actorId })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[mercury deposits] matching run failed', error)
    return NextResponse.json({ error: 'Mercury deposit matching unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('mercury-deposits', req, () => handle(req), { leaseSeconds: 120 })
}
