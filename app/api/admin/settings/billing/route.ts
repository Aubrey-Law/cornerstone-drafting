import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { parseAnnualGoalCents } from '@/lib/billing/weeklySnapshot'
import { loadAnnualGoalCents, updateAnnualGoalCents } from '@/lib/billing/weeklySnapshotServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — the annual collection goal. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  return NextResponse.json({ annualGoalCents: await loadAnnualGoalCents() })
}

/** PATCH — set the annual collection goal, in cents. Administrators only. */
export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err) return auth.err
  const body = await req.json().catch(() => null) as { annualGoalCents?: unknown } | null
  let cents: number
  try {
    cents = parseAnnualGoalCents(body?.annualGoalCents)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid goal' }, { status: 400 })
  }
  try {
    return NextResponse.json({ annualGoalCents: await updateAnnualGoalCents(cents) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save the goal' }, { status: 500 })
  }
}
