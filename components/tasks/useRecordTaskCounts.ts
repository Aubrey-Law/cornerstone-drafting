'use client'

import { useCallback, useMemo, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { recordTaskCounts, type RecordTaskCounts, type TaskRow } from '@/lib/tasks/types'

/**
 * Open/overdue counts for one record, for the Tasks tab trigger badge. The tab
 * body unmounts when another tab is active, so the badge keeps its own count —
 * seeded on the server, then re-read only after the tab changes something.
 *
 * `recordTaskCounts` deliberately lives in `lib/tasks/types` rather than here:
 * the server pages seed this badge, and they cannot call into a client module.
 */
export function useRecordTaskCounts(recordId: string, initial: RecordTaskCounts) {
  const token = useAccessToken()
  const [counts, setCounts] = useState(initial)

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/tasks?status=open&recordId=${recordId}`, {
        headers: authHeaders,
        cache: 'no-store',
      })
      if (!res.ok) return
      const json = await res.json()
      setCounts(recordTaskCounts((json.tasks ?? []) as TaskRow[]))
    } catch {
      // A stale badge is not worth surfacing an error for.
    }
  }, [recordId, authHeaders])

  return { ...counts, refresh }
}
