'use client'

import { RouteErrorState } from '@/components/RouteErrorState'

export default function EmailTriageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteErrorState
      error={error}
      reset={reset}
      title="Email triage could not load"
      description="The queue could not be read. Nothing in your mailbox has been changed."
      backHref="/admin"
    />
  )
}
