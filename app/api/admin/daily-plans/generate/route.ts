import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { fetchDailyPlan, saveDailyPlan } from '@/lib/work/plans'
import { recordCommandCenterUsageSafely } from '@/lib/work/usageServer'
import { getDailyPlanCalendarStatus } from '@/lib/work/dailyPlanCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({})) as { date?: unknown }
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : firmTodayKey()
  const [graph, preferences, existing] = await Promise.all([
    fetchWorkGraphForUser(auth.userId),
    fetchWorkPreferences(auth.userId),
    fetchDailyPlan(auth.userId, date),
  ])
  const preview = createDailyPlanPreview({ items: graph.items, preferences, appointments: graph.appointments, date })
  const stored = await saveDailyPlan({
    userId: auth.userId,
    preview,
    interruptionBufferPercent: preferences.interruptionBufferPercent,
  })
  await recordCommandCenterUsageSafely({
    userId: auth.userId,
    event: existing ? 'plan_replanned' : 'plan_generated',
  })
  const calendarStatus = await getDailyPlanCalendarStatus(getAdminClient(), stored, graph.items)
  return NextResponse.json({ plan: stored, preview, sourceErrors: graph.sourceErrors, calendarStatus })
}
