export const OPEN_STAFF_SOFTPHONE_EVENT = 'cornerstone:open-softphone'

export type OpenSoftphoneDetail = {
  /** Digits to prefill in the dialer. Any format — the dialer normalizes it. */
  number?: string
}

/**
 * Focus the phone. The rail switches to its Phone tab; the dialer prefills the
 * number when one is supplied. Dispatched as a `CustomEvent` so older
 * payload-free `new Event(...)` dispatches keep working (detail is undefined).
 */
export function openStaffSoftphone(detail?: OpenSoftphoneDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<OpenSoftphoneDetail>(OPEN_STAFF_SOFTPHONE_EVENT, { detail }))
}
