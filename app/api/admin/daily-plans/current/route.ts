import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchDailyPlan } from '@/lib/work/plans'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const requested = new URL(req.url).searchParams.get('date')
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : firmTodayKey()
  const plan = await fetchDailyPlan(auth.userId, date)
  return NextResponse.json({ plan })
}
