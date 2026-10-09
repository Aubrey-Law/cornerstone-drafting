'use client'

import { useLayoutEffect } from 'react'
import { retainSettingsHistoryInterceptor } from './navigation'

/** Install before Next's popstate listener can hide an editor during traversal. */
export function SettingsHistoryBoundary() {
  useLayoutEffect(() => retainSettingsHistoryInterceptor(), [])
  return null
}
