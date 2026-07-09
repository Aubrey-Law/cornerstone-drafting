import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchSidebarCounts } from '@/lib/queries/sidebarCounts'
import { SIDEBAR_COUNTS_TAG } from '@/lib/sidebarCountsInvalidation'

const getSidebarCounts = unstable_cache(
  async () => fetchSidebarCounts(),
  ['sidebar-counts'],
  { revalidate: 30, tags: [SIDEBAR_COUNTS_TAG] },
)

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const counts = await getSidebarCounts()
  return NextResponse.json(counts, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  })
}
