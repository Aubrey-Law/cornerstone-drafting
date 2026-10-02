import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { executeDailyPlanClose } from '@/lib/work/dailyPlanCloseAction'
import { recordCommandCenterUsageSafely } from '@/lib/work/usageServer'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid daily plan' }, { status: 400 })
  try {
    const execution = await executeDailyPlanClose(id, auth.user)
    await recordCommandCenterUsageSafely({ userId: auth.userId, event: 'plan_closed' })
    return NextResponse.json({ plan: execution.result })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The daily plan could not be closed',
    }, { status: 409 })
  }
}
