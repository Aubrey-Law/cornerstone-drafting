import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { buildEndOfDayClosePreview } from '@/lib/work/endOfDay'
import { fetchDailyPlanById } from '@/lib/work/plans'
import { fetchWorkGraphForUser } from '@/lib/work/server'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid daily plan' }, { status: 400 })
  try {
    const [plan, graph] = await Promise.all([
      fetchDailyPlanById(auth.userId, id),
      fetchWorkGraphForUser(auth.userId),
    ])
    if (!plan) return NextResponse.json({ error: 'Daily plan not found' }, { status: 404 })
    if (plan.status !== 'committed') {
      return NextResponse.json({ error: 'Only a committed daily plan can be closed' }, { status: 409 })
    }
    return NextResponse.json({ preview: buildEndOfDayClosePreview(plan, graph.items) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to review the daily plan' }, { status: 500 })
  }
}
