import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { executeDailyPlanCalendarSync } from '@/lib/work/dailyPlanCalendarAction'
import { executeDailyPlanCommit } from '@/lib/work/dailyPlanCommitAction'
import { recordCommandCenterUsageSafely } from '@/lib/work/usageServer'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid daily plan' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { planningDurationSeconds?: unknown }
  const planningDurationSeconds = typeof body.planningDurationSeconds === 'number' && Number.isFinite(body.planningDurationSeconds)
    ? Math.max(0, Math.min(86_400, Math.round(body.planningDurationSeconds)))
    : null
  try {
    const execution = await executeDailyPlanCommit(id, auth.user)
    const plan = execution.result as { id: string; status: string }
    await recordCommandCenterUsageSafely({ userId: auth.userId, event: 'plan_committed', durationSeconds: planningDurationSeconds })
    let calendarSync = null
    let calendarSyncError: string | null = null
    try {
      calendarSync = await executeDailyPlanCalendarSync(plan.id, auth.user)
    } catch (error) {
      // The commitment is authoritative even if a provider is unavailable.
      calendarSyncError = error instanceof Error ? error.message : 'Calendar blocks could not be synced'
    }
    return NextResponse.json({ plan, calendarSync, calendarSyncError })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The daily plan could not be committed',
    }, { status: 409 })
  }
}
