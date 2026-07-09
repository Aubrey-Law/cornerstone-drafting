'use client'

import { useEffect, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { CallRow, type CallRowData } from './CallRow'

interface Props {
  matterId: string
  limit?: number
}

export function CallList({ matterId, limit = 50 }: Props) {
  const token = useAccessToken()
  const [calls, setCalls] = useState<CallRowData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token || !matterId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/admin/matters/${matterId}/calls?limit=${limit}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        const body = await res.json().catch(() => ([]))
        if (cancelled) return
        if (!res.ok) {
          setError(typeof body.error === 'string' ? body.error : 'Failed to load calls')
          setCalls([])
        } else {
          setError(null)
          setCalls(Array.isArray(body) ? body : body.calls ?? [])
        }
      } catch {
        if (!cancelled) setError('Failed to load calls')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, matterId, limit])

  if (loading) {
    return <div className="px-3 py-6 text-sm text-muted-foreground">Loading calls…</div>
  }
  if (error) {
    return <div className="text-sm text-destructive">Failed to load calls: {error}</div>
  }
  if (calls.length === 0) {
    return <div className="px-3 py-6 text-sm text-muted-foreground">No calls logged yet.</div>
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {calls.map((c) => (
        <CallRow key={c.id} call={c} />
      ))}
    </div>
  )
}
