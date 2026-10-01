import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { saveDailyPlan } from '@/lib/work/plans'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err
  const body = await req.json().catch(() => ({})) as { date?: unknown }
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : firmTodayKey()
  const [graph, preferences] = await Promise.all([
    fetchWorkGraphForUser(auth.userId),
    fetchWorkPreferences(auth.userId),
  ])
  const preview = createDailyPlanPreview({ items: graph.items, preferences, appointments: graph.appointments, date })
  const stored = await saveDailyPlan({
    userId: auth.userId,
    preview,
    interruptionBufferPercent: preferences.interruptionBufferPercent,
  })
  return NextResponse.json({ plan: stored, preview, sourceErrors: graph.sourceErrors })
}
