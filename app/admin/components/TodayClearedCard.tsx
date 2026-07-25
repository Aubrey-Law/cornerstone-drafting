'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { TODAY_CLEARED_EVENT } from '@/app/admin/components/TodayQueue'

/** Session tally of items actioned, snoozed, or nudged from Today. */
export function TodayClearedCard() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const handler = () => setCount(prev => prev + 1)
    window.addEventListener(TODAY_CLEARED_EVENT, handler)
    return () => window.removeEventListener(TODAY_CLEARED_EVENT, handler)
  }, [])

  return (
    <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      {count === 0 ? 'Nothing cleared yet this session' : `${count} cleared today`}
    </p>
  )
}
