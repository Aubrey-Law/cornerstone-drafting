'use client'

import { requestDeparture } from '@/lib/navigation/departure'
export const SETTINGS_HISTORY_CHANGE_EVENT = 'cornerstone:settings-history-change'
const historyMarker = '__cornerstoneSettingsHistory'
type HistoryPosition = { scope: string; index: number }
let tracking: { retain: () => () => void } | null = null
const historyGuards = new Set<(event: PopStateEvent) => void>()
let interceptorOwners = 0
function interceptHistory(event: PopStateEvent) {
  for (const guard of historyGuards) {
    guard(event)
    if (event.cancelBubble) return
  }
}

/** Mounted once before the router; inert unless a visible editor registers. */
export function retainSettingsHistoryInterceptor(): () => void {
  if (interceptorOwners++ === 0) window.addEventListener('popstate', interceptHistory, true)
  let released = false
  return () => {
    if (released) return
    released = true
    if (--interceptorOwners === 0) window.removeEventListener('popstate', interceptHistory, true)
  }
}

export function registerSettingsHistoryGuard(guard: (event: PopStateEvent) => void): () => void {
  historyGuards.add(guard)
  return () => { historyGuards.delete(guard) }
}

export function settingsHistoryPosition(state: unknown): HistoryPosition | null {
  if (!state || typeof state !== 'object') return null
  const value = (state as Record<string, unknown>)[historyMarker]
  if (!value || typeof value !== 'object') return null
  const { scope, index } = value as Record<string, unknown>
  return typeof scope === 'string' && Number.isSafeInteger(index) ? { scope, index: index as number } : null
}

/** Start at the shared Settings boundary, before any editor or Settings links run. */
export function retainSettingsHistoryTracking(): () => void {
  if (tracking) return tracking.retain()
  const browser = window
  const history = browser.history
  const originalPush = history.pushState
  const originalReplace = history.replaceState
  let owners = 0
  let active = true
  const position = () => settingsHistoryPosition(history.state) ?? { scope: crypto.randomUUID(), index: 0 }
  const changed = () => browser.dispatchEvent(new Event(SETTINGS_HISTORY_CHANGE_EVENT))
  const push: History['pushState'] = function (this: History, data, unused, url) {
    if (!active) return originalPush.call(this, data, unused, url)
    const current = position()
    originalPush.call(this, { ...data, [historyMarker]: { ...current, index: current.index + 1 } }, unused, url)
    changed()
  }
  const replace: History['replaceState'] = function (this: History, data, unused, url) {
    if (!active) return originalReplace.call(this, data, unused, url)
    originalReplace.call(this, { ...data, [historyMarker]: position() }, unused, url)
    changed()
  }
  originalReplace.call(history, { ...history.state, [historyMarker]: position() }, '')
  history.pushState = push
  history.replaceState = replace
  const tracker = {
    retain() {
      owners += 1
      let released = false
      return () => {
        if (released) return
        released = true
        owners -= 1
        if (owners) return
        active = false
        if (history.pushState === push) history.pushState = originalPush
        if (history.replaceState === replace) history.replaceState = originalReplace
        if (tracking === tracker) tracking = null
      }
    },
  }
  tracking = tracker
  return tracker.retain()
}

/** Imperative Settings controls use the same cancellable boundary as links. */
export function navigateSettings(destination: string, proceed: () => void, trigger: HTMLElement) {
  requestDeparture({ destination, proceed, trigger })
}
