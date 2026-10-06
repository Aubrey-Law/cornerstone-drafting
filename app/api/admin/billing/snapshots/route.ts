import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { listWeeklySnapshots, loadAnnualGoalCents, runWeeklyFinancialSnapshot } from '@/lib/billing/weeklySnapshotServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — the stored weekly snapshots, newest first, and the annual goal they are measured against. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    const [snapshots, goalCents] = await Promise.all([listWeeklySnapshots(12), loadAnnualGoalCents()])
    return NextResponse.json({ snapshots: snapshots ?? [], unavailable: snapshots === null, goalCents })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load the weekly snapshots' }, { status: 500 })
  }
}

/**
 * POST — run the snapshot now for the week just ended and send the email,
 * even if this week's was already sent. Administrators only.
 */
export async function POST(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err) return auth.err
  try {
    const result = await runWeeklyFinancialSnapshot({ force: true })
    if (result.unavailable) return NextResponse.json({ error: 'The snapshot table has not reached this database yet' }, { status: 503 })
    if (!result.stored) return NextResponse.json({ error: result.error ?? 'Could not compute the snapshot' }, { status: 500 })
    return NextResponse.json({ ok: result.ok, sent: result.sent, emailStatus: result.emailStatus, weekStart: result.weekStart, error: result.error })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not run the weekly snapshot' }, { status: 500 })
  }
}
