const EVENT = 'matter-contacts-changed'
type ContactChange = { matterId: string; source?: string }

/** Invalidate other mounted contact views only after a successful mutation. */
export function notifyMatterContactsChanged(matterId: string, source?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ContactChange>(EVENT, { detail: { matterId, source } }))
  }
}

export function listenForMatterContacts(matterId: string, refresh: () => void, source?: string): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const change = (event as CustomEvent<ContactChange>).detail
    if (change?.matterId === matterId && (!source || change.source !== source)) refresh()
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
