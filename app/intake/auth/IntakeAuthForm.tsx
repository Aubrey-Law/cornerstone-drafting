'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { ensureUserProfile } from '@/lib/auth/ensureUserProfile'
import {
  MIN_CLIENT_PASSWORD_LENGTH,
  isExistingAccountAuthError,
  validateNewClientPassword,
} from '@/lib/auth/clientPassword'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const inputCls =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground'

export default function IntakeAuthForm({
  inviteToken,
  invitedEmail,
}: {
  inviteToken: string
  invitedEmail?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState(invitedEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signInHref = `/auth/login?redirectTo=${encodeURIComponent('/intake')}`

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const passwordError = validateNewClientPassword(password, confirmPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }

    setLoading(true)

    const signupRes = await fetch('/api/intake/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken,
        email: email.trim(),
        password,
      }),
    })

    if (!signupRes.ok) {
      const body = await signupRes.json().catch(() => ({}))
      const msg = typeof body.error === 'string' ? body.error : 'Could not create your account.'
      if (isExistingAccountAuthError(msg) || signupRes.status === 409) {
        setError('An account with this email already exists. Sign in to continue.')
      } else {
        setError(msg)
      }
      setLoading(false)
      return
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (!signInError && signInData.user) {
      await ensureUserProfile(supabase, signInData.user)
    }

    setLoading(false)

    if (signInError) {
      setError(
        'Your account was created, but we could not sign you in automatically. Use the sign-in link below.',
      )
      return
    }

    toast.success('Welcome — starting your intake')
    router.replace('/intake')
    router.refresh()
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
      <div>
        <Label htmlFor="intake-email">Email address</Label>
        <Input
          id="intake-email"
          type="email"
          required
          autoComplete="email"
          readOnly={Boolean(invitedEmail)}
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={inputCls}
        />
        {invitedEmail ? (
          <p className="mt-1 text-xs text-muted-foreground">
            This invitation is tied to the email on your matter.
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="intake-password">Create a password</Label>
        <Input
          id="intake-password"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_CLIENT_PASSWORD_LENGTH}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className={inputCls}
          placeholder={`At least ${MIN_CLIENT_PASSWORD_LENGTH} characters`}
        />
      </div>

      <div>
        <Label htmlFor="intake-confirm-password">Confirm password</Label>
        <Input
          id="intake-confirm-password"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_CLIENT_PASSWORD_LENGTH}
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          className={inputCls}
        />
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          {error.includes('already exists') ? (
            <>
              {' '}
              <Link href={signInHref} className="font-medium underline">
                Sign in
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={loading || !email || !password || !confirmPassword}>
        {loading ? 'Creating account…' : 'Create account & continue'}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{' '}
        <Link href={signInHref} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
