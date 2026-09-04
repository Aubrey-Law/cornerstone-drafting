'use client'

/**
 * Route-segment error boundary. Without one, a thrown render error in any page
 * falls through to Next's unstyled default. Error reporting is wired in
 * instrumentation.ts when the first authenticated surface lands; this boundary
 * is the user-facing half and exists from day one.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <section className="w-full max-w-md space-y-4 rounded-xl border p-6 text-center">
        <h1 className="text-xl font-semibold">The Workbench hit an error</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong loading this page. Try again; if it keeps happening, note the
          reference below.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">Reference {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium"
        >
          Try again
        </button>
      </section>
    </main>
  )
}
