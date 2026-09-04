'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@aubrey-law/ui/button'
import { Input } from '@aubrey-law/ui/input'
import { Label } from '@aubrey-law/ui/label'
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
export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paramError = searchParams.get('error')
  const message =
    error ??
    (paramError === 'no_role'
      ? 'You are signed in, but your account has no role assigned yet, so there is nothing to open. Ask Scott to set one.'
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {message ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {message}
        </p>
      ) : null}

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
