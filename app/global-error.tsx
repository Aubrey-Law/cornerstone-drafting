'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

import { getFirmConfig } from '@/lib/firmConfig'

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

  const firm = getFirmConfig()

  return (
    <html lang="en">
      <body className="antialiased">
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
          <section className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{firm.firmName}</p>
              <h1 className="text-xl font-semibold">We could not load this page</h1>
              <p className="text-sm text-muted-foreground">
                Something went wrong on our end. Please try again, and get in touch if the
                problem continues.
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
            <p className="border-t border-border pt-4 text-sm">
              <a className="underline underline-offset-2" href={`tel:${firm.phone.replace(/[^\d+]/g, '')}`}>
                {firm.phone}
              </a>
              <span aria-hidden className="px-2 text-muted-foreground">&middot;</span>
              <a className="underline underline-offset-2" href={`mailto:${firm.email}`}>
                {firm.email}
              </a>
            </p>
          </section>
        </main>
      </body>
    </html>
  )
}
