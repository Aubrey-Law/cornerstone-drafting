'use client'
import { useEffect, useRef, useState } from 'react'
import { SETTINGS_HISTORY_CHANGE_EVENT, retainSettingsHistoryTracking, registerSettingsHistoryGuard, settingsHistoryPosition } from '@/app/admin/settings/navigation'
import { DEPARTURE_REQUEST_EVENT, type DepartureAction, type DepartureRequest } from '@/lib/navigation/departure'
export function useDiscoveryDeparture(unsafe:boolean) {
 const allowDeparture=useRef(false), departureAction=useRef<DepartureAction|null>(null), departureTrigger=useRef<HTMLElement|null>(null)
 const [confirmingDeparture,setConfirmingDeparture]=useState(false),[error,setError]=useState<string|null>(null)
  useEffect(() => {
    // Next may restore this editor through an Activity boundary with refs intact.
    // A prior confirmed departure authorizes only that departure, never the next.
    allowDeparture.current = false
    const samePage = (href: string) => {
      const destination = new URL(href, window.location.href)
      return destination.pathname === window.location.pathname && destination.search === window.location.search && destination.origin === window.location.origin
    }
    const askToLeave = (proceed: DepartureAction, trigger: HTMLElement | null) => {
      if (departureAction.current) return
      departureAction.current = proceed
      departureTrigger.current = trigger
      setConfirmingDeparture(true)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsafe || allowDeparture.current) return
      event.preventDefault(); event.returnValue = ''
    }
    const click = (event: MouseEvent) => {
      if (!unsafe || allowDeparture.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return
      if (samePage(destination.href)) return
      event.preventDefault(); event.stopPropagation()
      askToLeave(() => window.location.assign(destination.href), anchor)
    }
    const imperative = (event: Event) => {
      const { destination, proceed, trigger } = (event as CustomEvent<DepartureRequest>).detail
      if (!unsafe || allowDeparture.current || (destination && samePage(destination))) return
      event.preventDefault(); askToLeave(proceed, trigger)
    }
    // Cancel traversals before Next observes popstate. No synthetic history entries,
    // URL changes, or replay loops are needed in browsers with the Navigation API.
    const navigation = (window as unknown as { navigation?: EventTarget & { traverseTo: (key: string) => unknown } }).navigation
    const navigate = (event: Event) => {
      const traversal = event as Event & { navigationType: string; destination: { url: string; key: string; sameDocument: boolean } }
      if (!unsafe || allowDeparture.current || traversal.navigationType !== 'traverse' || !event.cancelable ||
        !traversal.destination.sameDocument || samePage(traversal.destination.url)) return
      event.preventDefault()
      askToLeave(() => { navigation?.traverseTo(traversal.destination.key) }, document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }
    // The Settings boundary indexes entries before the editor mounts. Retain a
    // reference here too so a standalone or cached editor has the same boundary.
    const releaseHistory = navigation ? undefined : retainSettingsHistoryTracking()
    let currentState: unknown = window.history.state
    let currentPosition = settingsHistoryPosition(currentState)
    let currentHref = window.location.href
    let restoring = false
    let restored: (() => void) | null = null
    const rememberHistory = () => {
      currentState = window.history.state
      currentPosition = settingsHistoryPosition(currentState)
      currentHref = window.location.href
    }
    const pop = (event: PopStateEvent) => {
      if (restoring) { event.stopImmediatePropagation(); restoring = false; restored?.(); restored = null; return }
      if (!unsafe || allowDeparture.current || samePage(currentHref)) { rememberHistory(); return }
      event.stopImmediatePropagation()
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const destination = window.location.href
      const nextPosition = settingsHistoryPosition(event.state)
      if (!nextPosition || !currentPosition || nextPosition.scope !== currentPosition.scope || nextPosition.index === currentPosition.index) {
        // Legacy History exposes no index for an entry created outside Settings.
        // Keep the local editor intact at this entry; a confirmed departure uses
        // the captured URL and replaces this entry instead of guessing a delta.
        window.history.replaceState(currentState, '', currentHref)
        askToLeave(() => window.location.replace(destination), trigger)
        return
      }
      const delta = nextPosition.index - currentPosition.index
      restoring = true
      restored = () => askToLeave(() => window.history.go(delta), trigger)
      window.history.go(-delta)
    }
    const unregisterHistoryGuard = navigation ? undefined : registerSettingsHistoryGuard(pop)
    if (navigation) navigation.addEventListener('navigate', navigate)
    else {
      window.addEventListener(SETTINGS_HISTORY_CHANGE_EVENT, rememberHistory)
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener(DEPARTURE_REQUEST_EVENT, imperative)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener(DEPARTURE_REQUEST_EVENT, imperative); document.removeEventListener('click', click, true)
      navigation?.removeEventListener('navigate', navigate)
      unregisterHistoryGuard?.()
      window.removeEventListener(SETTINGS_HISTORY_CHANGE_EVENT, rememberHistory)
      releaseHistory?.()
    }
  }, [unsafe])

  function cancelDeparture() {
    departureAction.current = null
    setConfirmingDeparture(false)
  }
  async function confirmDeparture() {
    const proceed = departureAction.current
    if (!proceed) return
    departureAction.current = null
    allowDeparture.current = true
    setConfirmingDeparture(false)
    try {
      if (await proceed() !== false) return
    } catch {
      setError('Unable to leave this page. Please try again.')
    }
    // A failed asynchronous side effect (for example sign-out) grants no
    // permission to discard the still-mounted editor on the next departure.
    allowDeparture.current = false
    restoreDepartureFocus()
  }
  function restoreDepartureFocus() {
    if (!allowDeparture.current && departureTrigger.current?.isConnected) departureTrigger.current.focus()
  }

 return {confirmingDeparture,cancelDeparture,confirmDeparture,restoreDepartureFocus,error}
}
