'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type { RecordTaskCounts } from '@/lib/tasks/types'

/** Server-seeded badge totals, refreshed as aggregates after task mutations. */
export function useRecordTaskCounts(recordId: string, initial: RecordTaskCounts) {
  const token = useAccessToken()
  const [state, setState] = useState({ recordId, counts: initial, error: null as string | null })
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [recordId, token])
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const res = await fetch(`/api/admin/tasks/counts?recordId=${encodeURIComponent(recordId)}`, {
        headers: authHeaders,
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Task counts could not be refreshed.')
      const json = await res.json()
      const counts = json.counts as RecordTaskCounts | undefined
      if (!counts || !Number.isSafeInteger(counts.open) || !Number.isSafeInteger(counts.overdue)
        || counts.open < 0 || counts.overdue < 0 || counts.overdue > counts.open) {
        throw new Error('Task counts could not be refreshed.')
      }
      if (request === generation.current) setState({ recordId, counts, error: null })
    } catch {
      if (request === generation.current) setState(previous => ({
        recordId,
        counts: previous.recordId === recordId ? previous.counts : initial,
        error: 'Task counts could not be refreshed.',
      }))
    }
  }, [recordId, authHeaders, initial])

  const current = state.recordId === recordId ? state : { counts: initial, error: null }
  return { ...current.counts, error: current.error, refresh }
}
