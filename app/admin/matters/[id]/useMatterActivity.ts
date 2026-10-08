'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { MatterActivity } from '@/types/database'

/** The matter's activity feed: the server's first page, older pages on demand, and rows logged here. */
export function useMatterActivity(matterId: string, initialActivity: MatterActivity[], initialCursor: string | null) {
  const [activity, setActivity] = useState<MatterActivity[]>(initialActivity)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const loadOlder = useCallback(async () => {
    if (!cursor) return
    setLoadingOlder(true)
    try {
      const response = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/activity?before=${encodeURIComponent(cursor)}`)
      const body = (await response.json().catch(() => ({}))) as { activity?: MatterActivity[]; cursor?: string | null; error?: string }
      if (!response.ok || !body.activity) throw new Error(body.error ?? 'Could not load older activity')
      const older = body.activity
      setActivity(current => {
        const seen = new Set(current.map(item => item.id))
        return [...current, ...older.filter(item => !seen.has(item.id))]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      })
      setCursor(body.cursor ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load older activity')
    } finally {
      setLoadingOlder(false)
    }
  }, [cursor, matterId])

  const prepend = useCallback((row: MatterActivity) => {
    setActivity(current => {
      if (current.some(item => item.id === row.id)) return current
      return [row, ...current]
    })
  }, [])

  return { activity, cursor, loadingOlder, loadOlder, prepend }
}
