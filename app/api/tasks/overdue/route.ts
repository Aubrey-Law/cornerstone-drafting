import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchOverdueTasks } from '@/lib/slaTasks/queries'

/**
 * GET /api/tasks/overdue — SLA tasks past their due date that nobody has
 * completed or skipped, across all matters.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const limit = Number(new URL(req.url).searchParams.get('limit'))

  try {
    const tasks = await fetchOverdueTasks(getAdminClient(), {
      limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
    })
    return NextResponse.json({ tasks })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load overdue tasks' },
      { status: 500 },
    )
  }
}
