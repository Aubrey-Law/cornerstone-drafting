'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * The boundary for an error thrown in the root layout, where `app/error.tsx`
 * cannot render because the layout it lives inside is what failed. It must
 * supply its own html and body, and it cannot use the app's styles.
 */
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
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#09090b',
          color: '#fafafb',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1>We could not load the Workbench</h1>
          <p style={{ color: '#a1a1aa' }}>
            Something went wrong before the page could render. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: '2.25rem',
              padding: '0 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #27272b',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
