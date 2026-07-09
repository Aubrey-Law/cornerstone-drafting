'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'

const PREFETCH_DELAY_MS = 100

export function useDebouncedPrefetch(href: string) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchedRef = useRef(false)

  const schedulePrefetch = () => {
    if (prefetchedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      prefetchedRef.current = true
      router.prefetch(href)
    }, PREFETCH_DELAY_MS)
  }

  const cancelPrefetch = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  return { schedulePrefetch, cancelPrefetch }
}
