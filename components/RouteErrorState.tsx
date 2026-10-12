'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface RouteErrorStateProps {
  error: Error & { digest?: string }
  reset: () => void
  title: string
  description: string
  retryLabel?: string
  backHref?: string
  backLabel?: string
  /** A second way out, used when the primary back link is the page that failed. */
  secondaryHref?: string
  secondaryLabel?: string
  minHeightClassName?: string
}
export function RouteErrorState({
  error,
  reset,
  title,
  description,
  retryLabel = 'Try again',
  backHref,
  backLabel,
  secondaryHref,
  secondaryLabel,
  minHeightClassName = 'min-h-[50vh]',
}: RouteErrorStateProps) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className={`flex ${minHeightClassName} flex-col items-center justify-center gap-4 px-6 text-center`}>
      <AlertTriangle className="size-10 text-destructive" aria-hidden />
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={reset}>
          {retryLabel}
        </Button>
        {backHref && backLabel && (
          <Button size="sm" asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        )}
        {secondaryHref && secondaryLabel && (
          <Button size="sm" variant={backHref ? 'outline' : 'default'} asChild>
            <Link href={secondaryHref}>{secondaryLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
