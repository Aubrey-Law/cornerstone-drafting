'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function PortalError({
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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">We could not load this page</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong on our end. Nothing you have submitted was lost — please try again,
          and contact us if it keeps happening.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Button size="sm" asChild>
          <Link href="/dashboard">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
