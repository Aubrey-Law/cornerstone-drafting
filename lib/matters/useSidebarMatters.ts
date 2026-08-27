'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useUserPreferences } from '@/lib/userPreferencesClient'
import { MAX_PINNED_MATTERS } from '@/lib/userPreferences'
import type { MatterNavRow } from '@/lib/queries/sidebarMatters'

/**
 * The sidebar's matter lists and the pinning that orders them.
 *
 * Pins live in `users.preferences.nav`, not in localStorage, so they follow the
 * user between devices. localStorage is kept as a mirror purely so the pinned
 * section paints on first render instead of appearing a round trip later — the
 * server value wins as soon as it arrives.
 *
 * Call this once per tree. The shell renders its nav twice (desktop column and
 * mobile sheet); two independent copies of this hook would double-fetch and could
 * disagree about what is pinned.
 */

const PINNED_STORAGE_KEY = 'cornerstone.admin.pinnedMatters'

function readCachedPins(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeCachedPins(ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* a full or blocked store is not worth failing a navigation over */
  }
}

export interface SidebarMattersState {
  pinned: MatterNavRow[]
  recent: MatterNavRow[]
  loading: boolean
  isPinned: (matterId: string) => boolean
  togglePin: (matterId: string) => void
  movePin: (matterId: string, direction: -1 | 1) => void
}

export function useSidebarMatters(): SidebarMattersState {
  const { savePreferences, loadPreferences } = useUserPreferences()
  const pathname = usePathname()
  // `new` and `list` are sibling routes under /admin/matters, not matter ids.
  const activeMatterId = pathname.match(/^\/admin\/matters\/(?!new$|list$)([^/]+)$/)?.[1] ?? null
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [rows, setRows] = useState<{ pinned: MatterNavRow[]; recent: MatterNavRow[] }>({
    pinned: [],
    recent: [],
  })
  const [loading, setLoading] = useState(true)
  // Guards the first server read from being overwritten by a slower one, and
  // stops a pin saved mid-flight from being reverted by a stale response.
  const requestRef = useRef(0)

  useEffect(() => {
    setPinnedIds(readCachedPins())
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const prefs = await loadPreferences()
      if (cancelled || !prefs) return
      const serverPins = prefs.nav?.pinnedMatterIds ?? []
      setPinnedIds(serverPins)
      writeCachedPins(serverPins)
    })()
    return () => {
      cancelled = true
    }
  }, [loadPreferences])

  const loadRows = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const query = activeMatterId ? `?active=${encodeURIComponent(activeMatterId)}` : ''
      const response = await fetch(`/api/admin/sidebar-matters${query}`)
      if (!response.ok) return
      const data = (await response.json()) as { pinned?: MatterNavRow[]; recent?: MatterNavRow[] }
      if (request !== requestRef.current) return
      setRows({ pinned: data.pinned ?? [], recent: data.recent ?? [] })
    } catch {
      // The matter lists are a convenience; the shell renders without them.
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [activeMatterId])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const persist = useCallback(
    (ids: string[]) => {
      setPinnedIds(ids)
      writeCachedPins(ids)
      void savePreferences({ nav: { pinnedMatterIds: ids } }).then(() => loadRows())
    },
    [savePreferences, loadRows],
  )

  const togglePin = useCallback(
    (matterId: string) => {
      const next = pinnedIds.includes(matterId)
        ? pinnedIds.filter(id => id !== matterId)
        : // Appended rather than prepended: a new pin should not displace the
          // order the user already arranged above it.
          [...pinnedIds, matterId].slice(0, MAX_PINNED_MATTERS)
      persist(next)
    },
    [pinnedIds, persist],
  )

  const movePin = useCallback(
    (matterId: string, direction: -1 | 1) => {
      const from = pinnedIds.indexOf(matterId)
      const to = from + direction
      if (from === -1 || to < 0 || to >= pinnedIds.length) return
      const next = [...pinnedIds]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      persist(next)
    },
    [pinnedIds, persist],
  )

  const isPinned = useCallback((matterId: string) => pinnedIds.includes(matterId), [pinnedIds])

  /**
   * Ordered by the stored list rather than by the server response, so a pin
   * toggled a moment ago is in its new place before the refetch lands.
   */
  const pinned = useMemo(() => {
    const byId = new Map(
      [...rows.pinned, ...rows.recent].map(row => [row.matter_id, row] as const),
    )
    return pinnedIds
      .map(id => byId.get(id))
      .filter((row): row is MatterNavRow => row !== undefined)
  }, [pinnedIds, rows])

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const recent = useMemo(
    () => rows.recent.filter(row => !pinnedSet.has(row.matter_id)),
    [rows.recent, pinnedSet],
  )

  return { pinned, recent, loading, isPinned, togglePin, movePin }
}
