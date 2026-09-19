import { readConsentToken } from '@/lib/marketing/consentTokens'
import { ConfirmButton } from './ConfirmButton'

export const dynamic = 'force-dynamic'

/**
 * /marketing/confirm?token=… — the second half of a double opt-in.
 *
 * Public: the whole point is that the person has no account. Authorization is
 * possession of a token this app signed and emailed to the address being
 * confirmed.
 *
 * This page only reads the token to decide what to show. The write happens in
 * the server action behind the button — see actions.ts for why it is not done
 * here.
 */
export default async function ConfirmSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const params = await searchParams
  const raw = Array.isArray(params.token) ? params.token[0] : params.token
  const read = readConsentToken(raw)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold text-foreground">Confirm your subscription</h1>

      {read.ok ? (
        <>
          <p className="text-sm text-muted-foreground">
            Confirm that <strong>{read.email}</strong> should receive updates from Aubrey Law.
          </p>
          <ConfirmButton token={raw as string} />
        </>
      ) : (
        <p className="text-sm text-destructive" role="alert">
          {read.reason === 'expired'
            ? 'This link has expired. Links are valid for seven days — please subscribe again to get a new one.'
            : 'This link is not valid. Please subscribe again.'}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Nothing is sent until you confirm, and you can unsubscribe from any email we send.
      </p>
    </main>
  )
}
