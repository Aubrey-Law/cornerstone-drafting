'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { AuthShell } from '@/components/layout/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_ADMIN_HOME,
  safeAdminRedirectPath,
  safeClientRedirectPath,
} from '@/lib/auth/safeRedirect'
import { ensureUserProfile } from '@/lib/auth/ensureUserProfile'
import { toast } from 'sonner'

const ADMIN_ROLES = ['attorney', 'admin'] as const

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

async function resolveDestination(userId: string, redirectTo: string | null): Promise<string> {
  const { data: authData } = await supabase.auth.getUser()
  const user = authData.user
  if (!user || user.id !== userId) {
    await supabase.auth.signOut()
    return '/auth/login?error=auth_failed'
  }

  const role = await ensureUserProfile(supabase, user)
  if (role && ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return safeAdminRedirectPath(redirectTo) ?? DEFAULT_ADMIN_HOME
  }
  if (role === 'client') {
    return safeClientRedirectPath(redirectTo) ?? '/dashboard'
  }
  await supabase.auth.signOut()
  return '/auth/login?error=auth_failed'
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo')
  const error = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [oauthPending, setOauthPending] = useState<'google' | null>(null)

  useEffect(() => {
    if (error === 'firm_domain_required') {
      toast.error('Staff sign-in requires an @aubreylegal.com account.')
    } else if (error === 'staff_only') {
      toast.error('Staff accounts only for that destination. Clients can sign in below.')
    } else if (error === 'auth_failed') {
      toast.error('Sign-in failed. Please try again.')
    }
  }, [error])

  async function signInWithOAuth(provider: 'google') {
    setOauthPending(provider)
    const callbackUrl = new URL('/auth/callback', window.location.origin)
    const safeRedirect =
      safeAdminRedirectPath(redirectTo) ?? safeClientRedirectPath(redirectTo)
    if (safeRedirect) callbackUrl.searchParams.set('redirectTo', safeRedirect)

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl.toString(),
        scopes: 'email',
      },
    })
    if (oauthError) {
      toast.error(oauthError.message)
      setOauthPending(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      toast.error(signInError.message)
    } else if (data.user) {
      const destination = await resolveDestination(data.user.id, redirectTo)
      router.push(destination)
      router.refresh()
    }
    setLoading(false)
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      toast.error('Enter your email address first.')
      return
    }
    setResetLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    if (resetError) toast.error(resetError.message)
    else toast.success('Password reset email sent.')
    setResetLoading(false)
  }

  return (
    <AuthShell>
      {/* Stronger border + elevated card so the form reads against the dark shell. */}
      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border-strong bg-card p-5 shadow-md sm:p-8">
          <div>
            <h2 className="text-center text-lg font-medium text-foreground">Sign in</h2>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              Staff and client access
            </p>
          </div>

          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void signInWithOAuth('google')}
              disabled={oauthPending !== null}
              className="h-11 w-full gap-2.5"
            >
              <GoogleIcon />
              {oauthPending === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </Button>
            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or continue with email</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="login-email">Email address</Label>
            <Input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 text-base md:text-sm"
            />
          </div>

          <PasswordInput
            id="login-password"
            label="Password"
            toggleLabel="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Your password"
            labelAction={
              <Button
                type="button"
                variant="link"
                onClick={() => void handlePasswordReset()}
                disabled={resetLoading}
                className="-my-2 h-auto min-h-11 px-0 text-xs font-medium"
              >
                {resetLoading ? 'Sending…' : 'Forgot password?'}
              </Button>
            }
          />

          <Button type="submit" disabled={loading} className="h-11 w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
      </form>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
