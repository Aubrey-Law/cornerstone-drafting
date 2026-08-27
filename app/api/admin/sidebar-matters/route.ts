import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchSidebarMatters } from '@/lib/queries/sidebarMatters'
import { parseUserPreferences } from '@/lib/userPreferences'

/**
 * The sidebar's matter lists.
 *
 * Not cached with `unstable_cache` the way sidebar counts are: the pinned half is
 * per-user, so a shared cache entry would leak one user's pins to another.
 */
export async function GET(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle()

  // An older firm database without the preferences column still gets recents.
  if (error && !error.message.includes('preferences')) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pinnedIds = parseUserPreferences(data?.preferences).nav?.pinnedMatterIds ?? []
  // The matter currently open, so it stays listed even when too old to rank.
  const activeMatterId = new URL(req.url).searchParams.get('active')
  const result = await fetchSidebarMatters(pinnedIds, activeMatterId)

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  })
}
