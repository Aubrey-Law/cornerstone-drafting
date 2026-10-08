'use client'

export const SETTINGS_NAVIGATION_EVENT = 'cornerstone:settings-navigation'
export type SettingsNavigationRequest = { destination: string; proceed: () => void; trigger: HTMLElement }

/** Imperative Settings controls use the same cancellable boundary as links. */
export function navigateSettings(destination: string, proceed: () => void, trigger: HTMLElement) {
  const event = new CustomEvent<SettingsNavigationRequest>(SETTINGS_NAVIGATION_EVENT, {
    cancelable: true, detail: { destination, proceed, trigger },
  })
  if (window.dispatchEvent(event)) proceed()
}
