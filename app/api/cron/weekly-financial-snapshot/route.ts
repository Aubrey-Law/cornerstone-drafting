import { NextResponse } from 'next/server'
import { runSystemAutomation } from '@/lib/automations/control'
import { runWeeklyFinancialSnapshot } from '@/lib/billing/weeklySnapshotServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Each Monday morning: read the ledger for the week just ended, store the
 * figures, compare them with the week before, and email the firm. A second
 * run on the same Monday refreshes the row and sends nothing.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runWeeklyFinancialSnapshot()
    const { snapshot: _snapshot, ...summary } = result
    return NextResponse.json(summary, { status: result.unavailable ? 503 : result.ok || result.stored ? 200 : 500 })
  } catch (error) {
    console.error('[weekly snapshot] run failed', error)
    return NextResponse.json({ error: 'Weekly financial snapshot unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('weekly-financial-snapshot', req, () => handle(req), { leaseSeconds: 120 })
}
