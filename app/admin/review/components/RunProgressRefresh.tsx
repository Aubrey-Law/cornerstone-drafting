'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { RunStatus } from '@/lib/runs/steps'

/**
 * Keeps an open run page catching up with a run that a cron tick is working
 * in the background.
 *
 * The plan called for `export const revalidate = 5` on the run pages, and it
 * was implemented, and it does nothing: both `app/prompts/[runId]/page.tsx`
 * and `app/review/[runId]/page.tsx` call `getSessionUser()`, which reads
 * `cookies()`, which forces the page fully dynamic. `revalidate` only governs
 * how long Next may cache a *response* before regenerating it on the next
 * request — it has no way to reach into a tab a user already has open and
 * make it ask for a new one. A user who started a forty-unit run would see
 * "0 of 40" and watch it never move until they reloaded by hand.
 *
 * So this polls, on the client, with `router.refresh()`. That is not the
 * ideal design — it exists only because there is no realtime channel in this
 * codebase (no websocket, no Supabase Realtime subscription) for a progress
 * display to lean on instead. It stops the moment the run settles: a poller
 * that never stops is a page that hammers the database forever on every
 * abandoned tab, and a run that has already reached `completed`, `partial`,
 * or `failed` will never move again, so there is nothing left to catch up
 * with.
 */
export function RunProgressRefresh({ runStatus }: { runStatus: RunStatus }) {
  const router = useRouter()
  const settled = runStatus === 'completed' || runStatus === 'partial' || runStatus === 'failed'

  useEffect(() => {
    // No interval at all once settled — not an interval that fires and finds
    // nothing to do. `settled` is in the dependency array, so a status change
    // on rerender (running -> completed) clears whatever interval this effect
    // last set before deciding whether to set a new one.
    if (settled) return

    const id = setInterval(() => {
      router.refresh()
    }, 5000)

    return () => clearInterval(id)
  }, [settled, router])

  return null
}
