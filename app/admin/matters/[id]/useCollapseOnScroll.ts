'use client'

import { useEffect, useState } from 'react'

/** Scroll distance before the header collapses, and the point it returns. */
const COLLAPSE_AT = 48
const EXPAND_AT = 4

/**
 * Collapses the matter header once anything inside `ref` scrolls down, and
 * restores it at the top. Inner panes (the design sheet) scroll on their own,
 * so this listens in the capture phase. `media` limits it to a breakpoint.
 */
export function useCollapseOnScroll<T extends HTMLElement>(media?: string) {
  // A callback ref, so the listener attaches whenever the element mounts —
  // not only if it already existed on the hook's first render.
  const [root, ref] = useState<T | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    if (!root) return
    const query = media && typeof window.matchMedia === 'function' ? window.matchMedia(media) : null
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (query && !query.matches) { setCollapsed(false); return }
      if (target.scrollTop > COLLAPSE_AT) setCollapsed(true)
      else if (target.scrollTop <= EXPAND_AT) setCollapsed(false)
    }
    const onMedia = () => { if (query && !query.matches) setCollapsed(false) }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    query?.addEventListener('change', onMedia)
    return () => {
      root.removeEventListener('scroll', onScroll, { capture: true })
      query?.removeEventListener('change', onMedia)
    }
  }, [media, root])
  return { ref, collapsed }
}
