'use client'

import { useState, useTransition } from 'react'

type ConfirmResult = { ok: true } | { ok: false; reason: 'expired' | 'invalid' | 'error' }

/**
 * The one interactive element of the confirm page: a button that POSTs.
 *
 * Client-side so the result can replace the button in place rather than
 * navigating — the person arrived here from their email and there is nowhere
 * useful to send them afterwards.
 */
export function ConfirmButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ConfirmResult | null>(null)
  const [failed, setFailed] = useState(false)

  if (result?.ok) {
    return (
      <p className="text-sm text-green" role="status">
        You&rsquo;re subscribed. You can unsubscribe from any email we send.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setFailed(false)
          try {
            const response = await fetch('/api/marketing/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            })
            setResult(await response.json() as ConfirmResult)
          } catch {
            // A network failure, not a bad token. Say so, and leave the button
            // usable — the link is still valid and retrying is the right move.
            setFailed(true)
          }
        })}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Confirming…' : 'Confirm subscription'}
      </button>

      {result && !result.ok && (
        <p className="text-sm text-destructive" role="alert">
          {result.reason === 'expired'
            ? 'This link has expired. Please subscribe again to get a new one.'
            : result.reason === 'error'
              ? 'Something went wrong on our end. Please try again.'
              : 'This link is not valid. Please subscribe again.'}
        </p>
      )}
      {failed && (
        <p className="text-sm text-destructive" role="alert">
          Something went wrong on our end. Please try again.
        </p>
      )}
    </div>
  )
}
