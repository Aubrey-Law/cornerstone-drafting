import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { executeDailyPlanCalendarSync } from '@/lib/work/dailyPlanCalendarAction'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid daily plan' }, { status: 400 })
  try {
    const calendarSync = await executeDailyPlanCalendarSync(id, auth.user)
    return NextResponse.json({ calendarSync })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Calendar blocks could not be synced',
    }, { status: 409 })
  }
}
