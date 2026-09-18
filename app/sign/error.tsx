'use client'

import { ClientErrorState } from '@/components/ClientErrorState'

/**
 * The signing page had no boundary at all, which made it the worst-covered
 * screen in the app and the one where that costs most: a client alone with an
 * estate plan, on a single-use link, doing the one thing here that cannot be
 * undone.
 *
 * The detail deliberately does not claim nothing was signed. This boundary
 * catches a render failure, and a render can fail *after* a successful POST —
 * rare, but not impossible, and a client who signed and is told they did not
 * would sign again. Telling them how to check is honest where a reassurance
 * would not be.
 */
export default function SignError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ClientErrorState
      error={error}
      reset={reset}
      title="We could not load your agreement"
      detail="Your signing link still works, so trying again is safe. If you had just signed or declined and are not sure whether it went through, please call us rather than doing it twice — we can see it from our side."
    />
  )
}
