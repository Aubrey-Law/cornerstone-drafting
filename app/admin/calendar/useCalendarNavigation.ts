'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuthSession } from '@/lib/auth/AuthTokenProvider'
import { calendarAnchorDate } from '@/lib/calendarDay'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { CalendarView } from './types'
import { toast } from 'sonner'

export const VIEW_KEY = 'cornerstone.calendar.view'
export function resolveCalendarView(url: string | null, saved: string | null): CalendarView {
  const valid = (value: string | null): value is CalendarView => ['day', 'week', 'month', 'plan'].includes(value ?? '')
  return valid(url) ? url : valid(saved) ? saved : 'day'
}
export function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function resolveCalendarDate(url: string | null, initial: string | null | undefined, now: Date, timezone = FIRM_TIMEZONE): Date {
  const today = calendarAnchorDate(now.toLocaleDateString('en-CA', { timeZone: timezone }), now)
  return calendarAnchorDate(url, calendarAnchorDate(initial, today))
}
export function shortcutBlocked(event: KeyboardEvent): boolean {
  return event.isComposing || event.repeat || Boolean(
    event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="listbox"], [role="menu"]'),
  ) || Boolean(document.querySelector('[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]'))
}

export function useCalendarNavigation(initialDay?: string | null, timezone = FIRM_TIMEZONE) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const query = params.toString()
  const session = useAuthSession()
  const [state, setState] = useState(() => ({ view: 'day' as CalendarView, anchor: resolveCalendarDate(null, initialDay, new Date(), timezone), selectedDay: calendarDateKey(resolveCalendarDate(null, initialDay, new Date(), timezone)), ready: false }))
  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(VIEW_KEY) } catch { /* Browser storage is optional. */ }
    const incoming = new URLSearchParams(query)
    const view = resolveCalendarView(incoming.get('view'), saved)
    const anchor = resolveCalendarDate(incoming.get('date'), initialDay, new Date(), timezone)
    const selectedDay = calendarDateKey(anchor)
    setState(current => current.ready && current.view === view && calendarDateKey(current.anchor) === selectedDay ? current : { view, anchor, selectedDay, ready: true })
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* Browser storage is optional. */ }
    incoming.set('view', view)
    incoming.set('date', selectedDay)
    if (incoming.toString() !== query) router.replace(`${pathname}?${incoming}`, { scroll: false })
  }, [query, initialDay, pathname, router, timezone])

  const update = useCallback((view: CalendarView, anchor: Date, selectedDay = calendarDateKey(anchor), explicitView = false) => {
    setState({ view, anchor, selectedDay, ready: true })
    const next = new URLSearchParams(window.location.search)
    next.set('view', view)
    next.set('date', calendarDateKey(anchor))
    router.replace(`${pathname}?${next}`, { scroll: false })
    try {
      localStorage.setItem(VIEW_KEY, view)
      if (explicitView && session?.user.id) {
        const key = `cornerstone.calendar.view-hint.${session.user.id}`
        if (!localStorage.getItem(key)) {
          toast.message(`Opens on ${view[0].toUpperCase()}${view.slice(1)} next time.`)
          localStorage.setItem(key, '1')
        }
      }
    } catch { /* Navigation works without storage. */ }
  }, [router, pathname, session?.user.id])
  return { ...state, update }
}
