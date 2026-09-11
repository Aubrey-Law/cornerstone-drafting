'use client'
import { useEffect } from 'react'
import { firmRoute, primaryContentReady, startNavigation, type FirmRoute } from '@/lib/performance/navigationTiming'
export function NavigationTiming() {
  useEffect(() => {
    function clicked(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const url = new URL(anchor.href, location.origin)
      if (url.origin !== location.origin || url.pathname === location.pathname) return
      const route = firmRoute(url.pathname)
      if (route) startNavigation(route)
    }
    document.addEventListener('click', clicked, true)
    return () => document.removeEventListener('click', clicked, true)
  }, [])
  return null
}
/** Mount beside hydrated primary rows and controls, outside optional sections. */
export function usePrimaryReady(route: FirmRoute, recordKey?: string) {
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => primaryContentReady(route)) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [route, recordKey])
}
export function NavigationReady({ route }: { route: FirmRoute }) {
  usePrimaryReady(route)
  return null
}
