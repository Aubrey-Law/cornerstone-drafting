'use client'
import { useEffect, useState } from 'react'
/** One clock shared by the entire calendar, including background-tab recovery. */
export function useCalendarClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  return now
}
