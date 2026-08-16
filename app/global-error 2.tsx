'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
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
    <html lang="en">
      <body className="antialiased">
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
          <section className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Cornerstone Drafting</p>
              <h1 className="text-xl font-semibold">We could not load Cornerstone</h1>
              <p className="text-sm text-muted-foreground">
                Something went wrong on our end. Please try again; your saved matter data is not
                changed by retrying.
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  )
}
