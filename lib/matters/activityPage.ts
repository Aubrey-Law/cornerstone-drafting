import type { MatterActivity } from '@/types/database'

/** Matter activity rows read per page, on the matter page and when loading older ones. */
export const MATTER_ACTIVITY_PAGE = 50

/**
 * Where the next older page starts: the oldest matter row of a full page, or
 * null when the page was short and nothing older remains.
 */
export function olderActivityCursor(matterRows: Pick<MatterActivity, 'created_at'>[]): string | null {
  if (matterRows.length < MATTER_ACTIVITY_PAGE) return null
  return matterRows.reduce<string | null>(
    (oldest, row) => (!oldest || Date.parse(row.created_at) < Date.parse(oldest) ? row.created_at : oldest),
    null,
  )
}

/**
 * The timeline as far back as it is complete. Lead history arrives whole, but
 * matter rows only to the cursor, so anything older than it would sit next to
 * a gap where unloaded matter events belong; it shows once they are loaded.
 */
export function completeActivity<T extends Pick<MatterActivity, 'created_at'>>(activity: T[], cursor: string | null): T[] {
  if (!cursor) return activity
  const floor = Date.parse(cursor)
  return activity.filter(item => Date.parse(item.created_at) >= floor)
}
