'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { getFirmConfig } from '@/lib/firmConfig'

/**
 * What a client sees when a client-facing page throws.
 *
 * `RouteErrorState` is the admin one, and it is the wrong thing here: it offers
 * a way back into a section of the admin app, and it speaks in the product's
 * voice. The people on these pages are clients. They did not come to
 * Cornerstone, they came to the firm, and when the screen breaks the useful
 * thing is not a section link — it is a telephone number.
 *
 * So this one carries three things the admin version does not:
 *
 *   - `client-root`, so the headings keep the serif the rest of the client path
 *     uses rather than switching face on the one screen that already looks
 *     broken.
 *   - the firm's own name, from the same config the booking pages read.
 *   - a real way to reach the office. `getFirmConfig` reads NEXT_PUBLIC_*, which
 *     is inlined at build, so these are safe in a client component and are the
 *     same details the firm's mail signature uses.
 *
 * `detail` is per-surface and says what is true of *that* page — whether work
 * was saved, whether an action went through. It is passed in rather than
 * written here because the honest answer differs by page, and a reassurance
 * that is not true of the page it is on is worse than none.
 */
export function ClientErrorState({
  error,
  reset,
  title,
  detail,
}: {
  error: Error & { digest?: string }
  reset: () => void
  title: string
  /** What is true of this page: what was kept, and what to do if unsure. */
  detail: string
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  const firm = getFirmConfig()

  return (
    <main className="client-root flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 py-12 text-center text-foreground">
      <AlertTriangle className="size-9 text-destructive" aria-hidden />

      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{detail}</p>
      </div>

      <Button onClick={() => reset()}>Try again</Button>

      {/*
        Not a footnote. On a page a client cannot get past, reaching a person is
        the primary action and the retry is the secondary one — so the details
        are full size, and both are real links rather than text to copy out.
      */}
      <div className="max-w-md space-y-1 border-t border-border pt-5 text-sm">
        <p className="text-muted-foreground">
          If it keeps happening, please contact {firm.firmName} and we will sort it out.
        </p>
        <p className="font-medium">
          <a className="underline underline-offset-2" href={`tel:${firm.phone.replace(/[^\d+]/g, '')}`}>
            {firm.phone}
          </a>
          <span aria-hidden className="px-2 text-muted-foreground">
            &middot;
          </span>
          <a className="underline underline-offset-2" href={`mailto:${firm.email}`}>
            {firm.email}
          </a>
        </p>
      </div>
    </main>
  )
}
