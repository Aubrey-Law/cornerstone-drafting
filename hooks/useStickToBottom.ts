'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Keep a scrolling thread pinned to the newest message — but only while the
 * reader is already at the bottom.
 *
 * Every chat surface called `scrollIntoView` on each message change, so
 * scrolling back to re-read something during a long stream yanked you straight
 * back down.
 */
export function useStickToBottom<T extends HTMLElement>(dependencies: unknown[]) {
  const containerRef = useRef<T | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(true)

  /** Within a message's height of the bottom counts as "at the bottom". */
  const onScroll = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setPinned(distance < 80)
  }, [])

  useEffect(() => {
    if (!pinned) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    // The caller decides what "new content" means for its own thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, ...dependencies])

  const scrollToBottom = useCallback(() => {
    setPinned(true)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  return { containerRef, bottomRef, pinned, onScroll, scrollToBottom }
}
