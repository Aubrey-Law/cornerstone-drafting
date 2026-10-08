'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { refreshTodayCalendar } from '@/app/admin/calendar/refreshToday'
export function RefreshTodayCalendar() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState(false)
  return <><Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => {
    setError(false)
    try { await refreshTodayCalendar(); router.refresh() } catch { setError(true) }
  })}>{pending ? 'Refreshing…' : 'Refresh calendar'}</Button>{error && <p role="alert" className="w-full text-xs text-destructive">Calendar refresh failed. Please retry.</p>}</>
}
