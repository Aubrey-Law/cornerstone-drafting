'use client'

import { RouteErrorState } from '@/components/RouteErrorState'

export default function AdminError({
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
      title="Something went wrong"
      description="An unexpected error occurred in the drafting app. Your saved data is usually unaffected — try again or return to the hub."
      backHref="/admin/drafting"
      backLabel="Back to drafting hub"
    />
  )
}
