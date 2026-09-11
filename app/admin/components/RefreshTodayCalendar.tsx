'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { refreshTodayCalendar } from '@/app/admin/calendar/refreshToday'
export function RefreshTodayCalendar() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState(false)
  return <><button className="text-xs underline" disabled={pending} onClick={() => startTransition(async () => {
    setError(false)
    try { await refreshTodayCalendar(); router.refresh() } catch { setError(true) }
  })}>{pending ? 'Refreshing…' : 'Refresh calendar'}</button>{error && <p role="alert">Calendar refresh failed. Please retry.</p>}</>
}
