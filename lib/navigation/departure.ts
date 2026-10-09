'use client'

export const DEPARTURE_REQUEST_EVENT = 'cornerstone:departure-request'
/** An asynchronous action returns false when departure failed and work stays protected. */
export type DepartureAction = () => void | Promise<boolean>
export type DepartureRequest = {
  /** Omit for side effects such as sign-out, even on the current route. */
  destination?: string
  proceed: DepartureAction
  trigger: HTMLElement | null
}

/** Runs once, or returns false when a visible editor deferred it for confirmation. */
export function requestDeparture(request: DepartureRequest): boolean {
  let started = false
  const proceed: DepartureAction = () => {
    if (started) return
    started = true
    return request.proceed()
  }
  const event = new CustomEvent<DepartureRequest>(DEPARTURE_REQUEST_EVENT, {
    cancelable: true, detail: { ...request, proceed },
  })
  if (!window.dispatchEvent(event)) return false
  void proceed()
  return true
}
