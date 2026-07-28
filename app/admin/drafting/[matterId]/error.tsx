'use client'

import { RouteErrorState } from '@/components/RouteErrorState'

export default function MatterDraftingError({
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
      title="Workspace error"
      description="This matter's drafting workspace hit an error. Design sheet autosaves are preserved — reload the workspace or go back to the hub."
      retryLabel="Reload workspace"
      backHref="/admin/drafting"
      backLabel="Back to drafting hub"
      minHeightClassName="min-h-[40vh]"
    />
  )
}
