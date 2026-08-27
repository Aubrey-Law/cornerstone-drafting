import { useCallback, useState } from 'react'
import {
  STEPS,
  SignInError,
  readSupabaseConfig,
  signIn,
  type ProfileInfo,
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

type Phase = 'form' | 'working' | 'done' | 'no-host'

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

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)
      setPhase('working')
      setSteps({ credentials: 'pending', access: 'pending', handoff: 'pending' })

      try {
        const result = await signIn(email.trim(), password, {
          onStep: (id, state) => setSteps(prev => ({ ...prev, [id]: state })),
        })
        setProfile(result.profile)
        if (result.handedOff) {
          setPhase('done')
        } else {
          setToken(result.session.accessToken)
          setPhase('no-host')
        }
      } catch (err) {
        setError(
          err instanceof SignInError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
        )
        setPhase('form')
      }
    },
    [email, password],
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

      {phase === 'form' && !configError && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-center text-[color:var(--color-ink-muted)]">
            Sign in with your Cornerstone account.
          </p>
          <label className="block space-y-1">
            <span className="text-[color:var(--color-ink-muted)]">Email</span>
            <input
              type="email"
              required
              autoFocus
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

      {phase !== 'form' && <StepList steps={steps} />}

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
