import { NextResponse } from 'next/server'
import { reconcileStaleAgreements } from '@/lib/esign/reconcile'
import { runSystemAutomation } from '@/lib/automations/control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/esign-reconcile — catch up on in-flight engagement agreements
 * whose provider state we have not checked recently.
 *
 * Authorization and the batch limit live in this route and the module it
 * calls, not in the cron configuration: a schedule is a trigger, never a
 * security boundary, and vercel.json is the wrong place to hold either.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await reconcileStaleAgreements()
    return NextResponse.json(result, { status: result.unavailable ? 503 : 200 })
  } catch (e) {
    console.error('[esign reconcile]', e)
    return NextResponse.json({ error: 'Reconciliation unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('esign-reconcile', req, () => handle(req), { leaseSeconds: 300 })
}
