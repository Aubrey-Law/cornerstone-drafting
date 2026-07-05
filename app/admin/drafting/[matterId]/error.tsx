'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function MatterDraftingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">Workspace error</h1>
        <p className="text-sm text-muted-foreground">
          This matter&apos;s drafting workspace hit an error. Design sheet autosaves are preserved — reload the workspace or go back to the hub.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Reload workspace
        </Button>
        <Button size="sm" asChild>
          <Link href="/admin/drafting">Back to drafting hub</Link>
        </Button>
      </div>
    </div>
  )
}
