'use client'

import { useCallback, useMemo, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { isTaskOverdue, type TaskRow } from '@/lib/tasks/types'

export interface RecordTaskCounts {
  open: number
  overdue: number
}

/**
 * Open/overdue counts for one record, for the Tasks tab trigger badge. The tab
 * body unmounts when another tab is active, so the badge keeps its own count —
 * seeded on the server, then re-read only after the tab changes something.
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
      const tasks = (json.tasks ?? []) as TaskRow[]
      setCounts({ open: tasks.length, overdue: tasks.filter(t => isTaskOverdue(t)).length })
    } catch {
      // A stale badge is not worth surfacing an error for.
    }
  }, [recordId, authHeaders])

  return { ...counts, refresh }
}

/** Server-side helper: the counts shape the badge expects. */
export function recordTaskCounts(tasks: Array<Pick<TaskRow, 'status' | 'due_at' | 'soft_due_at' | 'hard_due_at'>>): RecordTaskCounts {
  return { open: tasks.length, overdue: tasks.filter(t => isTaskOverdue(t)).length }
}
