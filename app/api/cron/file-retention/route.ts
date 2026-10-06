import { NextResponse } from 'next/server'
import { resolveUnattendedActor } from '@/lib/actions/delegation'
import { runSystemAutomation } from '@/lib/automations/control'
import { prepareRetentionReview } from '@/lib/fileClosing/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Each Monday morning: find the closed files whose retention period has
 * ended and are not on hold, and propose a review task for each. Destroying a
 * file is always a person's decision; this only puts it in front of them.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const actorId = await resolveUnattendedActor().then(actor => actor?.id ?? null, () => null)
    const result = await prepareRetentionReview({ actorId })
    return NextResponse.json(result, { status: result.unavailable ? 503 : 200 })
  } catch (error) {
    console.error('[file retention] review run failed', error)
    return NextResponse.json({ error: 'File retention review unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('file-retention', req, () => handle(req), { leaseSeconds: 120 })
}
