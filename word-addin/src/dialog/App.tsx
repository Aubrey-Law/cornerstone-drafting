import { useCallback, useEffect, useRef, useState } from 'react'
import {
  STEPS,
  SignInError,
  beginOAuth,
  completeOAuthSignIn,
  readSupabaseConfig,
  signIn,
  type OAuthProvider,
  type ProfileInfo,
  type SignInResult,
  type StepId,
  type StepState,
} from './signIn'

/**
 * Wording here is deliberately unlike the task pane's.
 *
 * Both used to say "Checking your session…", and a stuck dialog was
 * indistinguishable from a stuck pane in a screenshot or a bug report — which
 * sent four rounds of fixes at the wrong component. `src/dialog/__tests__`
 * asserts the two vocabularies stay disjoint.
 */
const TITLE = 'Cornerstone for Word'

type Phase = 'form' | 'redirecting' | 'working' | 'done' | 'no-host'

/**
 * How long to sit on "Taking you to Microsoft…" before admitting the
 * navigation did not happen.
 *
 * Assigning `window.location` normally ends this page, so this timer usually
 * dies with it. It exists for the case where it does not — an Office dialog
 * refusing to leave its AppDomains, say — because a redirect that silently
 * fails is another window that waits forever with nothing on screen.
 */
const REDIRECT_TIMEOUT_MS = 8_000

/** GoTrue hands the result back on the query string. */
function readCallback(search: string): { code?: string; error?: string } {
  const params = new URLSearchParams(search)
  const error = params.get('error_description') ?? params.get('error')
  if (error) return { error }
  const code = params.get('code')
  return code ? { code } : {}
}

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [steps, setSteps] = useState<Record<StepId, StepState>>({
    credentials: 'pending',
    access: 'pending',
    handoff: 'pending',
  })
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /**
   * Checked up front rather than on submit. A build with no Supabase values
   * cannot sign anyone in, and finding that out only after typing a password is
   * a worse way to learn it.
   */
  const [configError] = useState<string | null>(() => {
    try {
      readSupabaseConfig()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })

  const onStep = useCallback(
    (id: StepId, state: StepState) => setSteps(prev => ({ ...prev, [id]: state })),
    [],
  )

  const settle = useCallback((result: SignInResult) => {
    setProfile(result.profile)
    if (result.handedOff) {
      setPhase('done')
    } else {
      setToken(result.session.accessToken)
      setPhase('no-host')
    }
  }, [])

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
    setPhase('form')
  }, [])

  /**
   * The branch that runs when the provider sends the dialog back.
   *
   * The page has been fully reloaded by this point — this is a different
   * document from the one that started the sign-in, which is exactly why the
   * verifier had to be in storage rather than in a variable.
   */
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || configError) return
    const { code, error: callbackError } = readCallback(globalThis.location?.search ?? '')
    if (!code && !callbackError) return
    resumed.current = true

    if (callbackError) {
      setError(callbackError)
      return
    }

    setPhase('working')
    void completeOAuthSignIn(code!, { onStep }).then(settle, fail)
  }, [configError, onStep, settle, fail])

  const startOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setError(null)
      setPhase('redirecting')
      try {
        const url = await beginOAuth(provider)
        setTimeout(() => {
          setError(
            'This window could not reach the sign-in page. Close it and try again, ' +
              'or sign in with an email and password below.',
          )
          setPhase('form')
        }, REDIRECT_TIMEOUT_MS)
        globalThis.location.assign(url)
      } catch (err) {
        fail(err)
      }
    },
    [fail],
  )

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)
      setPhase('working')
      setSteps({ credentials: 'pending', access: 'pending', handoff: 'pending' })

      try {
        settle(await signIn(email.trim(), password, { onStep }))
      } catch (err) {
        fail(err)
      }
    },
    [email, password, onStep, settle, fail],
  )

  const copyToken = useCallback(async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
    } catch {
      // Clipboard access can be refused in a dialog; the token is on screen and
      // selectable either way.
      setCopied(false)
    }
  }, [token])

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-5 text-sm">
      <h1 className="text-center text-base font-semibold">{TITLE}</h1>

      {configError && <p className="text-red-600">{configError}</p>}

      {phase === 'redirecting' && (
        <p className="text-center text-[color:var(--color-ink-muted)]">
          Opening your provider's sign-in page…
        </p>
      )}

      {phase === 'form' && !configError && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-center text-[color:var(--color-ink-muted)]">
            Sign in with your Cornerstone account.
          </p>

          {/*
            Providers first, in the same order as the web login page. Most of
            the firm signs in with Microsoft and has no password at all, so a
            password-only dialog asks for a credential that does not exist.
          */}
          <div className="space-y-2">
            <ProviderButton onClick={() => void startOAuth('azure')}>
              <MicrosoftIcon />
              Continue with Microsoft
            </ProviderButton>
            <ProviderButton onClick={() => void startOAuth('google')}>
              <GoogleIcon />
              Continue with Google
            </ProviderButton>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="h-px flex-1 bg-[color:var(--color-line)]" />
            <span className="text-[11px] text-[color:var(--color-ink-muted)]">
              or use an email and password
            </span>
            <span className="h-px flex-1 bg-[color:var(--color-line)]" />
          </div>

          <label className="block space-y-1">
            <span className="text-[color:var(--color-ink-muted)]">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded border border-[color:var(--color-line)] px-2 py-1"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[color:var(--color-ink-muted)]">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded border border-[color:var(--color-line)] px-2 py-1"
            />
          </label>
          {error && <p className="text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded bg-[color:var(--color-accent)] px-4 py-2 font-medium text-white"
          >
            Sign in
          </button>
          {/*
            The one question a stuck window cannot answer for itself is whether
            it is even running the code you just changed. Word caches add-in
            bundles hard enough that it usually is not.
          */}
          <p className="text-center text-[11px] text-[color:var(--color-ink-muted)]">
            build {__BUILD_STAMP__}
          </p>
        </form>
      )}

      {phase !== 'form' && phase !== 'redirecting' && <StepList steps={steps} />}

      {phase === 'done' && (
        <p className="text-center">
          Signed in as {profile?.name ?? profile?.email ?? 'your account'}. You can close
          this window.
        </p>
      )}

      {phase === 'no-host' && (
        <div className="space-y-2">
          <p>
            You are signed in, but this window could not hand the session back to Word.
            Close it and try <strong>Sign in</strong> again, or paste this token into the
            pane:
          </p>
          <textarea
            readOnly
            value={token ?? ''}
            onFocus={event => event.currentTarget.select()}
            aria-label="Access token"
            className="h-24 w-full rounded border border-[color:var(--color-line)] p-2 font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={() => void copyToken()}
            className="rounded border border-[color:var(--color-line)] px-3 py-1"
          >
            {copied ? 'Copied' : 'Copy token'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Same shape as the web login page's OAuth buttons, in the pane's palette. */
function ProviderButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded border border-[color:var(--color-line)] px-4 py-2 font-medium"
    >
      {children}
    </button>
  )
}

/* Brand marks copied from app/auth/login/page.tsx so the two sign-in surfaces
   look like the same product. Inline rather than imported: the add-in is a
   separate Vite app and does not build against the Next tree. */

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#F25022" d="M0 0h8.55v8.55H0z" />
      <path fill="#7FBA00" d="M9.45 0H18v8.55H9.45z" />
      <path fill="#00A4EF" d="M0 9.45h8.55V18H0z" />
      <path fill="#FFB900" d="M9.45 9.45H18V18H9.45z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

/**
 * The live step log.
 *
 * The point of showing all three at once, rather than one status line, is that
 * a failure names itself: whichever row is still spinning — or marked ✕ — is
 * the one to fix. Every step behind these rows has a deadline, so none of them
 * can spin forever.
 */
function StepList({ steps }: { steps: Record<StepId, StepState> }) {
  return (
    <ul className="space-y-1">
      {STEPS.map(({ id, label }) => {
        const state = steps[id]
        return (
          <li key={id} className="flex items-center gap-2">
            <span
              aria-hidden
              className={
                state === 'failed'
                  ? 'text-red-600'
                  : state === 'done'
                    ? 'text-green-700'
                    : 'text-[color:var(--color-ink-muted)]'
              }
            >
              {state === 'done' ? '✓' : state === 'failed' ? '✕' : state === 'running' ? '…' : '·'}
            </span>
            <span
              className={
                state === 'pending' ? 'text-[color:var(--color-ink-muted)]' : undefined
              }
            >
              {label}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
