'use client'

import { RouteErrorState } from '@/components/RouteErrorState'

export default function TextsError({
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
      title="Texts could not load"
      description="The conversations could not be read. No texts were sent or changed."
      backHref="/admin"
    />
  )
}
