import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { MATTER_ACTIVITY_PAGE, olderActivityCursor } from '@/lib/matters/activityPage'
import type { MatterActivity } from '@/types/database'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/matters/[id]/activity?before=<ISO> — the next page of this
 * matter's activity older than `before`, newest first. The matter page loads
 * the first page itself; this backs its "Show older activity".
 */
export async function GET(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })
  const before = new URL(req.url).searchParams.get('before')
  if (!before || Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: 'A valid "before" time is required' }, { status: 400 })
  }

  const { data, error } = await getAdminClient()
    .from('matter_activity')
    .select('*')
    .eq('matter_id', id)
    .lt('created_at', before)
    .order('created_at', { ascending: false })
    .limit(MATTER_ACTIVITY_PAGE)
  if (error) return NextResponse.json({ error: 'Could not load older activity' }, { status: 500 })

  const activity = (data ?? []) as MatterActivity[]
  return NextResponse.json({ activity, cursor: olderActivityCursor(activity) })
}
