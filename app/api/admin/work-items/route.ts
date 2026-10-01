import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { fetchTodayData } from '@/lib/queries/today'
import { buildWorkGraph } from '@/lib/work/buildWorkGraph'
import { reconcileWorkGraphs } from '@/lib/work/reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') ?? '')
    ? url.searchParams.get('date') as string
    : firmTodayKey()
  const [graph, preferences] = await Promise.all([
    fetchWorkGraphForUser(auth.userId),
    fetchWorkPreferences(auth.userId),
  ])
  const plan = createDailyPlanPreview({ items: graph.items, preferences, appointments: graph.appointments, date })
  if (url.searchParams.get('scope') === 'shadow') {
    const legacyToday = await fetchTodayData({ includeCalendar: false })
    const legacy = buildWorkGraph({ today: legacyToday }, new Date(graph.generatedAt))
    return NextResponse.json({
      ...graph,
      preferences,
      plan,
      reconciliation: reconcileWorkGraphs(legacy, graph),
    })
  }
  return NextResponse.json({ ...graph, preferences, plan })
}
