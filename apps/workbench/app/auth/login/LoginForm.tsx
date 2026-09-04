'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@aubrey-law/ui/button'
import { Input } from '@aubrey-law/ui/input'
import { Label } from '@aubrey-law/ui/label'
import { FIRM_EMAIL_DOMAIN } from '@/lib/auth/firmEmail'
import { STAFF_HOME, sanitizeSameOriginPath } from '@/lib/auth/gate'
import { classifySignInError, signInMessage } from '@/lib/auth/signInError'
import { getBrowserSupabase } from '@/lib/supabase/browser'

/**
 * Sign-in, and nothing else.
 *
 * Where a signed-in user belongs is not decided here. The form lands on the
 * remembered path (or the staff home) and the proxy redirects from there, so
 * the role rules live in exactly one place — `lib/auth/gate.ts` — rather than
 * being restated in the client where they can drift.
 */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paramError = searchParams.get('error')
  const message =
    error ??
    (paramError === 'firm_domain_required'
      ? `Signing in with Google needs an @${FIRM_EMAIL_DOMAIN} account. That address is not one, so you have been signed out.`
      : paramError === 'no_role'
        ? 'That account has no role assigned yet, so there is nothing to open. Ask Scott to set one.'
        : paramError
          ? 'Sign-in failed. Please try again.'
          : null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    const { data, error: signInError } = await getBrowserSupabase().auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !data?.user) {
      setError(signInMessage(classifySignInError(signInError)))
      setPending(false)
      return
    }

    // Structural check only — an unsanitised value here would make the
    // redirectTo parameter an open redirect. The role half of the rule is the
    // gate's, on the next request.
    const destination = sanitizeSameOriginPath(searchParams.get('redirectTo')) ?? STAFF_HOME
    router.replace(destination)
    router.refresh()
  }

  /**
   * The callback URL is built from the browser's own origin, which is correct
   * by construction — this code only ever runs on the page the user is looking
   * at. The remembered destination is sanitised before it travels: it comes
   * back as a query parameter on a URL the browser will follow, so an
   * unsanitised value would make the round trip an open redirect. The role half
   * of that rule is applied server-side in the callback.
   */
  async function onGoogle() {
    setGooglePending(true)
    setError(null)

    const callback = new URL('/auth/callback', window.location.origin)
    const remembered = sanitizeSameOriginPath(searchParams.get('redirectTo'))
    if (remembered) callback.searchParams.set('redirectTo', remembered)

    const { error: oauthError } = await getBrowserSupabase().auth.signInWithOAuth({
      provider: 'google',
      // `email` alone. The callback checks the address against the firm domain
      // and needs nothing else; asking for more would be scope this app never reads.
      options: { redirectTo: callback.toString(), scopes: 'email' },
    })

    if (oauthError) {
      setError('Google sign-in could not be started. Please try again, or use your email and password.')
      setGooglePending(false)
    }
    // On success the browser leaves for Google, so nothing is reset here.
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {message ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {message}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onGoogle}
        disabled={googlePending || pending}
      >
        <GoogleMark />
        {googlePending ? 'Opening Google…' : 'Continue with Google'}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
