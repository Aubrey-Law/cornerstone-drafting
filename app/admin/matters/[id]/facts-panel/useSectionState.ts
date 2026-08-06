'use client'

import { useCallback, useEffect, useState } from 'react'

export const FACTS_PANEL_SECTION_STORAGE_KEY = 'al.matterRail.openSections.v1'

export type FactsPanelSection =
  | 'contact' | 'spouse' | 'matter' | 'flags' | 'dates' | 'notes' | 'activity'

export type SectionState = Record<FactsPanelSection, boolean>

export const DEFAULT_SECTION_STATE: SectionState = {
  contact: true,
  spouse: true,
  matter: true,
  flags: true,
  dates: false,
  notes: false,
  activity: false,
}

const SECTION_KEYS = Object.keys(DEFAULT_SECTION_STATE) as FactsPanelSection[]

/** Merge stored state over the defaults, dropping unknown keys and non-booleans. */
function mergeStored(raw: string | null): SectionState {
  if (!raw) return DEFAULT_SECTION_STATE
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SECTION_STATE
    const merged = { ...DEFAULT_SECTION_STATE }
    for (const key of SECTION_KEYS) {
      if (typeof parsed[key] === 'boolean') merged[key] = parsed[key]
    }
    return merged
  } catch {
    return DEFAULT_SECTION_STATE
  }
}

/**
 * Which panel sections are open, remembered per browser. Hydration is state,
 * not a ref: the persist effect must not run before the restored value lands
 * or it would write the defaults straight back over it.
 */
export function useSectionState() {
  const [open, setOpen] = useState<SectionState>(DEFAULT_SECTION_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(FACTS_PANEL_SECTION_STORAGE_KEY)
    } catch {
      /* a blocked store just means defaults */
    }
    setOpen(mergeStored(stored))
    setRestored(Boolean(stored))
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(FACTS_PANEL_SECTION_STORAGE_KEY, JSON.stringify(open))
    } catch {
      /* ignore */
    }
  }, [hydrated, open])

  const toggle = useCallback((section: FactsPanelSection) => {
    setOpen(current => ({ ...current, [section]: !current[section] }))
  }, [])

  const collapseAll = useCallback(() => {
    setOpen(SECTION_KEYS.reduce(
      (next, key) => ({ ...next, [key]: false }),
      {} as SectionState,
    ))
  }, [])

  return { open, toggle, collapseAll, hydrated, restored }
}
