import { NextResponse } from 'next/server'
import { revalidateTag, unstable_cache } from 'next/cache'
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

  // `fetchSidebarCounts` catches a failing section and returns its fallback, so
  // a partial failure is an ordinary successful result as far as the cache is
  // concerned — and would be served to everyone for the next 30 seconds, with
  // no retry able to get behind it. Drop the entry so the next request re-runs
  // the queries that failed.
  if (counts.errors?.length) revalidateTag(SIDEBAR_COUNTS_TAG, 'max')

  return NextResponse.json(counts, {
    headers: {
      // Client-side too: a response carrying errors must not sit in the browser
      // cache for half a minute while the retry asks for it again.
      'Cache-Control': counts.errors?.length ? 'no-store' : 'private, max-age=30',
    },
  })
}
