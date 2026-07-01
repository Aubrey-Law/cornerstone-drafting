'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { portalUrl, appUrl } from '@/lib/urls'
import { toast } from 'sonner'
import {
  MIN_CLIENT_PASSWORD_LENGTH,
  isExistingAccountAuthError,
  validateNewClientPassword,
} from '@/lib/auth/clientPassword'
import { safeClientRedirectPath } from '@/lib/auth/safeRedirect'

const ADMIN_ROLES = ['attorney', 'admin']

// Returns an absolute URL so we can navigate across hosts (portal.* ↔ app.*)
// after login. When portal/app hosts are unset (local dev), the helpers fall
// back to the current origin and this still works as a same-origin nav.
async function getRoleDestination(userId: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()

  if (data && ADMIN_ROLES.includes(data.role)) {
    return appUrl('/admin/dashboard')
  }
  if (data?.role === 'va' || data?.role === 'staff') {
    return appUrl('/va/dashboard')
  }
  return portalUrl(safeClientRedirectPath(fallback) ?? '/dashboard')
}

// Cross-host-safe navigation: if the destination is a different origin,
// use a full page load instead of the SPA router (which can't cross hosts).
function navigateTo(router: ReturnType<typeof useRouter>, dest: string) {
  try {
    const target = new URL(dest, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
    if (typeof window !== 'undefined' && target.origin !== window.location.origin) {
      window.location.assign(target.toString())
      return
    }
    router.push(target.pathname + target.search + target.hash)
    router.refresh()
  } catch {
    router.push(dest)
    router.refresh()
  }
}

function currentOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

// ─── Shared logo ─────────────────────────────────────────────────────────────

function Logo({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const href = variant === 'dark' ? '/auth/login?type=admin' : '/auth/login'
  return (
    <div className="flex justify-center">
      <Link
        href={href}
        aria-label="Aubrey Law home"
        className="rounded-sm transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <Image
          src={`/logos/aubrey-law-stacked-${variant}.svg`}
          alt="Aubrey Law"
          width={240}
          height={140}
          priority
        />
      </Link>
    </div>
  )
}

// ─── Shared input / button styles ────────────────────────────────────────────

const inputCls =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground'

// ─── Social login (Google / Microsoft) ────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#F25022" d="M0 0h8.55v8.55H0z" />
      <path fill="#7FBA00" d="M9.45 0H18v8.55H9.45z" />
      <path fill="#00A4EF" d="M0 9.45h8.55V18H0z" />
      <path fill="#FFB900" d="M9.45 9.45H18V18H9.45z" />
    </svg>
  )
}

const oauthBtnCls =
  'flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-50'

// Buttons that kick off the Supabase OAuth (PKCE) flow. On success the browser
// is redirected to the provider and back to /auth/callback, which already
// creates the public.users row and routes by role — so no extra handling here.
function OAuthButtons({ redirectTo }: { redirectTo: string }) {
  const [pending, setPending] = useState<'google' | 'azure' | null>(null)

  async function signIn(provider: 'google' | 'azure') {
    setPending(provider)
    const base = `${currentOrigin()}/auth/callback`
    const callbackUrl = redirectTo ? `${base}?next=${encodeURIComponent(redirectTo)}` : base
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl },
    })
    if (error) {
      toast.error(error.message)
      setPending(null)
    }
    // On success the page navigates away to the provider; leave pending set.
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => signIn('google')}
        disabled={pending !== null}
        className={oauthBtnCls}
      >
        <GoogleIcon />
        {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
      </button>
      <button
        type="button"
        onClick={() => signIn('azure')}
        disabled={pending !== null}
        className={oauthBtnCls}
      >
        <MicrosoftIcon />
        {pending === 'azure' ? 'Redirecting…' : 'Continue with Microsoft'}
      </button>
      <div className="flex items-center gap-3 pt-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or continue with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}

// ─── Admin login ──────────────────────────────────────────────────────────────

function AdminLoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
    } else if (data.user) {
      const destination = await getRoleDestination(data.user.id, redirectTo)
      navigateTo(router, destination)
    }
    setLoading(false)
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      toast.error('Enter your email address first.')
      return
    }
    setResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${currentOrigin()}/auth/reset-password?type=admin`,
    })
    if (error) toast.error(error.message)
    else toast.success('Password reset email sent.')
    setResetLoading(false)
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <Logo variant="dark" />

      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border bg-card p-8 shadow-sm">
        <div>
          <h2 className="text-center text-lg font-medium text-foreground">Attorney Sign In</h2>
          <p className="mt-1 text-center text-xs text-muted-foreground/60">Aubrey Law staff access only</p>
        </div>

        <OAuthButtons redirectTo={redirectTo} />

        <div>
          <label htmlFor="admin-email" className="block text-sm font-medium text-foreground">
            Email address
          </label>
          <input
            id="admin-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="you@aubreylegal.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="admin-password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={resetLoading}
              className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
            >
              {resetLoading ? 'Sending…' : 'Forgot password?'}
            </button>
          </div>
          <input
            id="admin-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder="Your password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {/* Link to client portal */}
      <p className="text-center text-sm text-muted-foreground">
        Are you a client?{' '}
        <Link href="/auth/login" className="font-medium text-accent hover:underline">
          Access the Client Portal →
        </Link>
      </p>
    </div>
  )
}

// ─── Client login ─────────────────────────────────────────────────────────────

function ClientLoginForm({
  redirectTo,
  initialTab = 'signin',
  practice,
}: {
  redirectTo: string
  initialTab?: 'signin' | 'create'
  practice?: string | null
}) {
  const router = useRouter()
  const isProbateSignup = practice === 'probate'

  const [mode, setMode] = useState<'signin' | 'create'>(initialTab === 'create' ? 'create' : 'signin')

  // Sign-in state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [useMagicLink, setUseMagicLink] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [accountCreated, setAccountCreated] = useState(false)
  const [signinLoading, setSigninLoading] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const siteOrigin = currentOrigin()

  function authCallbackUrl() {
    const base = `${siteOrigin}/auth/callback`
    if (!redirectTo) return base
    return `${base}?next=${encodeURIComponent(redirectTo)}`
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setSigninLoading(true)

    if (useMagicLink) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authCallbackUrl() },
      })
      if (error) toast.error(error.message)
      else setMagicLinkSent(true)
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        toast.error(error.message)
      } else if (data.user) {
        const destination = await getRoleDestination(data.user.id, redirectTo)
        navigateTo(router, destination)
      }
    }

    setSigninLoading(false)
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    const passwordError = validateNewClientPassword(password, confirmPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }

    setCreateLoading(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: authCallbackUrl() },
    })
    if (error) {
      if (isExistingAccountAuthError(error.message)) {
        toast.error('An account with this email already exists. Sign in instead.')
        setMode('signin')
      } else {
        toast.error(error.message)
      }
    } else {
      setAccountCreated(true)
    }
    setCreateLoading(false)
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      toast.error('Enter your email address first.')
      return
    }
    setResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${siteOrigin}/auth/reset-password`,
    })
    if (error) toast.error(error.message)
    else toast.success('Password reset email sent.')
    setResetLoading(false)
  }

  // ── Success / magic-link-sent states ────────────────────────────────────────

  if (magicLinkSent || accountCreated) {
    const isMagic = magicLinkSent
    return (
      <div className="w-full max-w-md space-y-8">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <h2 className="text-lg font-medium text-green-800">Check your email</h2>
          <p className="mt-2 text-sm text-green-700">
            {isMagic ? (
              <>
                We sent a magic link to <strong>{email}</strong>. Click the link in your email to sign in.
              </>
            ) : (
              <>
                We sent a confirmation link to <strong>{email}</strong>. Click the link to activate your
                account, then sign in with your password or request a magic link.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setMagicLinkSent(false)
              setAccountCreated(false)
              setMode('signin')
            }}
            className="mt-4 text-sm text-accent hover:underline"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              mode === 'signin'
                ? 'border-b-2 border-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              mode === 'create'
                ? 'border-b-2 border-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Create account
          </button>
        </div>

        <div className="border-b border-border px-8 py-4">
          <h2 className="text-center text-lg font-medium text-foreground">
            {mode === 'create' ? 'Create Your Portal Account' : 'Client Sign In'}
          </h2>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {mode === 'create'
              ? isProbateSignup
                ? 'Set up your account to begin probate intake'
                : 'Use the email on your Aubrey Law invitation'
              : 'Sign in with your password or a magic link'}
          </p>
        </div>

        <div className="px-8 pt-6">
          <OAuthButtons redirectTo={redirectTo} />
        </div>

        {mode === 'create' ? (
          <form onSubmit={handleCreateAccount} className="space-y-5 p-8">
            <div>
              <label htmlFor="create-email" className="block text-sm font-medium text-foreground">
                Email address
              </label>
              <input
                id="create-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="create-password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="create-password"
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_CLIENT_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder={`At least ${MIN_CLIENT_PASSWORD_LENGTH} characters`}
              />
            </div>
            <div>
              <label htmlFor="create-confirm-password" className="block text-sm font-medium text-foreground">
                Confirm password
              </label>
              <input
                id="create-confirm-password"
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_CLIENT_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputCls}
                placeholder="Re-enter your password"
              />
            </div>
            <button
              type="submit"
              disabled={createLoading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50"
            >
              {createLoading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="space-y-5 p-8">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>

            {!useMagicLink && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-sm font-medium text-foreground">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={resetLoading}
                    className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    {resetLoading ? 'Sending…' : 'Forgot password?'}
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  required={!useMagicLink}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Your password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={signinLoading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50"
            >
              {signinLoading
                ? 'Signing in…'
                : useMagicLink
                  ? 'Send magic link'
                  : 'Sign in'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setUseMagicLink(!useMagicLink)}
                className="text-sm text-accent hover:underline"
              >
                {useMagicLink ? 'Use password instead' : 'Sign in with magic link'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Link to admin */}
      <p className="text-center text-sm text-muted-foreground/60">
        Aubrey Law staff?{' '}
        <Link href="/auth/login?type=admin" className="text-muted-foreground hover:underline">
          Attorney sign in →
        </Link>
      </p>
    </div>
  )
}

// ─── Page shell ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <Suspense>
      <LoginRouter />
    </Suspense>
  )
}

function LoginRouter() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const type = searchParams.get('type')
  const tab = searchParams.get('tab')
  const practice = searchParams.get('practice')
  const redirectTo = searchParams.get('redirectTo') ?? ''
  const error = searchParams.get('error')
  const isAdminLogin = type === 'admin'
  const shouldRedirectToLeadForm = !isAdminLogin && tab === 'create' && practice !== 'probate'
  const clientInitialTab = tab === 'create' ? 'create' : 'signin'

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || !error) return
    if (error === 'firm_domain_required') {
      toast.error('Staff sign-in requires an @aubreylegal.com account.')
    } else if (error === 'auth_failed') {
      toast.error('Sign-in failed. Please try again.')
    }
  }, [mounted, error])

  useEffect(() => {
    if (!mounted || !shouldRedirectToLeadForm) return
    router.replace('/intake/lead')
  }, [mounted, router, shouldRedirectToLeadForm])

  if (mounted && shouldRedirectToLeadForm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-sm text-muted-foreground">
        Redirecting to the consultation form…
      </div>
    )
  }

  return (
    <div className={`flex min-h-screen items-center justify-center bg-background px-4 py-12${isAdminLogin ? ' dark' : ''}`}>
      {isAdminLogin
        ? <AdminLoginForm redirectTo={redirectTo} />
        : (
          <ClientLoginForm
            redirectTo={redirectTo}
            initialTab={clientInitialTab}
            practice={practice}
          />
        )
      }
    </div>
  )
}
