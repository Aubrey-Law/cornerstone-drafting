'use client'

import { useCallback, useEffect, useState } from 'react'

export interface DirectoryEntry {
  /** last 10 digits — the match key */
  digits: string
  name: string
  /** Sub-label: matter number, "Lead", or "Trustee · Jane Smith". */
  detail: string | null
  matterId: string | null
  matterNumber: string | null
  leadId: string | null
  contactId: string | null
  practiceArea: string | null
  stage: string | null
}

/**
 * Loads the firm's phone directory once per mount and exposes a prefix lookup,
 * so the softphone can name a caller (and its matter) without a request per
 * keystroke. Payload is a few hundred rows.
 */
export function usePhoneDirectory() {
  const [entries, setEntries] = useState<DirectoryEntry[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/phone/directory')
        if (!res.ok) return
        const data = (await res.json()) as { entries?: DirectoryEntry[] }
        if (!cancelled && Array.isArray(data.entries)) setEntries(data.entries)
      } catch {
        /* directory is an enhancement — the dialer works without it */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Exact match on 10 digits, prefix match while the number is incomplete. */
  const lookup = useCallback(
    (digits: string): DirectoryEntry | null => {
      if (!digits) return null
      const exact = entries.find(e => e.digits === digits)
      if (exact) return exact
      if (digits.length >= 10) return null
      return entries.find(e => e.digits.startsWith(digits)) ?? null
    },
    [entries],
  )

  return { entries, lookup }
}
