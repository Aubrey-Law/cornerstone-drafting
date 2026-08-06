import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchUpcomingTasks } from '@/lib/slaTasks/queries'

/**
 * GET /api/tasks/upcoming — every open SLA task across all matters falling due
 * inside the next `?days=` (default 14), with the matter and client names.
 * Powers the matter ops board and the dashboard's Coming due card.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const url = new URL(req.url)
  const days = Number(url.searchParams.get('days'))
  const limit = Number(url.searchParams.get('limit'))

  try {
    const tasks = await fetchUpcomingTasks(getAdminClient(), {
      days: Number.isFinite(days) && days > 0 ? Math.min(Math.trunc(days), 365) : 14,
      limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
    })
    return NextResponse.json({ tasks })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load upcoming tasks' },
      { status: 500 },
    )
  }
}
