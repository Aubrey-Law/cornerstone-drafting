/**
 * Sign-in logic for the Office dialog.
 *
 * ## Why this is not a Next page
 *
 * It was one, at `/auth/addin`, proxied into the pane's origin. It never once
 * completed. The captured DOM of a stuck dialog showed office.js present only
 * as `<link rel="preload">` — the tag `next/script` injects *after* hydration
 * was absent, so React had never hydrated, so no effect had ever run and the
 * page sat forever on its server-rendered first paint.
 *
 * Rather than keep guessing which part of Next's dev runtime Word's WebView
 * dislikes — SSR, hydration, RSC, `/_next/*` through the Vite proxy, an HMR
 * WebSocket the proxy never upgrades — the dialog now ships from the add-in's
 * own Vite build, exactly like the task pane, which has worked in this WebView
 * from the first day.
 *
 * ## Why plain fetch and not supabase-js
 *
 * supabase-js wraps every auth call in `navigator.locks` and an
 * `initializePromise`, neither of which has a deadline. In a WebView that is
 * one more unbounded wait with no way to observe it. A password grant is one
 * POST; this module makes it, with a timeout, and can say what happened.
 *
 * Every step here has a deadline. Nothing in this file may wait forever.
 */

import { dialogUrl } from '@/dialogUrl'

/** The pane's `session.ts` parses this discriminator. Keep them identical. */
export const HANDOFF_TYPE = 'cornerstone-addin-session'

/** One network hop. Generous for a cold dev server, finite either way. */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * How long to wait for office.js. The script comes from Microsoft's CDN and a
 * cold dialog is slow, so this is generous — but bounded, because waiting
 * forever on it is the bug this whole module replaces.
 */
export const OFFICE_TIMEOUT_MS = 15_000

/** The three things that have to happen, in order, for sign-in to complete. */
export const STEPS = [
  { id: 'credentials', label: 'Checking your credentials' },
  { id: 'access', label: 'Checking firm access' },
  { id: 'handoff', label: 'Returning to Word' },
] as const

/** Providers the firm actually uses, matching `app/auth/login/page.tsx`. */
export type OAuthProvider = 'azure' | 'google'

/**
 * Scopes per provider, copied from the web login page so the consent screen the
 * attorney sees in the dialog is the one they have already agreed to.
 */
const OAUTH_SCOPES: Record<OAuthProvider, string> = {
  azure: 'email openid profile',
  google: 'email',
}

/**
 * Where the PKCE code verifier waits while the browser is away at Microsoft.
 *
 * `localStorage`, not `sessionStorage`: the dialog navigates right out of this
 * origin and back, and sessionStorage is the flakier of the two to survive that
 * in an embedded WebView. Deleted the moment it is redeemed — see
 * `completeOAuth`, which clears it even when the exchange fails, so a verifier
 * can never be replayed against a second code.
 */
const VERIFIER_KEY = 'cornerstone.addin.pkce-verifier.v1'

export type StepId = (typeof STEPS)[number]['id']
export type StepState = 'pending' | 'running' | 'done' | 'failed'

/**
 * An error whose message is meant for the attorney.
 *
 * Anything thrown from here is rendered verbatim in the dialog, which has no
 * developer tools and no console anyone will read. If it is not useful on
 * screen, it does not belong in the message.
 */
export class SignInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

export interface DialogSession {
  accessToken: string
  refreshToken: string | null
  /** Unix seconds, as Supabase reports it. */
  expiresAt: number | null
  email: string | null
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

/**
 * The Supabase project, read from the repo's own `.env`.
 *
 * `vite.config.ts` sets `envDir` to the repo root and widens `envPrefix` to
 * include `NEXT_PUBLIC_`, so these are the very same two public values the Next
 * app uses. Nothing new to configure, and nothing secret: the anon key is
 * shipped to every browser that loads Cornerstone.
 */
export function readSupabaseConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): SupabaseConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (typeof url !== 'string' || !url || typeof anonKey !== 'string' || !anonKey) {
    throw new SignInError(
      'This add-in build has no Supabase configuration. ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in the ' +
        'repository root .env before starting the add-in dev server.',
    )
  }

  return { url: url.replace(/\/+$/, ''), anonKey }
}

/** Office, as much of it as this file touches. */
interface OfficeGlobal {
  onReady?: (callback?: () => void) => Promise<unknown> | void
  context?: { ui?: { messageParent?: (message: string) => void } }
}

function defaultGetOffice(): OfficeGlobal | null {
  return (globalThis as { Office?: OfficeGlobal }).Office ?? null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface SignInDeps {
  fetch?: typeof fetch
  getOffice?: () => OfficeGlobal | null
  config?: SupabaseConfig
  /** Overridable so tests do not sit through the real Office deadline. */
  officeTimeoutMs?: number
  /** Where the PKCE verifier is parked across the redirect. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  /** Absolute URL the provider should send the dialog back to. */
  redirectTo?: string
  /** Called as each step changes state, so the dialog can show its progress. */
  onStep?: (id: StepId, state: StepState) => void
}

function verifierStore(deps: SignInDeps) {
  return deps.storage ?? globalThis.localStorage
}

/* ------------------------------------------------------------------ *
 * PKCE
 *
 * Deliberately hand-rolled rather than pulled in with supabase-js, whose
 * auth calls wrap everything in `navigator.locks` and an `initializePromise`
 * — neither bounded, and unbounded waits in a window with no console is the
 * failure mode this whole dialog exists to escape.
 *
 * The algorithm is not invented here: it matches
 * `@supabase/auth-js/dist/main/lib/helpers.js` byte for byte, so the values
 * this produces are the values GoTrue already expects.
 * ------------------------------------------------------------------ */

/** auth-js `dec2hex`: last two hex digits of each 32-bit word. */
const dec2hex = (dec: number) => `0${dec.toString(16)}`.slice(-2)

/** auth-js `generatePKCEVerifier`: 56 random words → 112 hex characters. */
function generateVerifier(): string {
  const words = new Uint32Array(56)
  crypto.getRandomValues(words)
  return Array.from(words, dec2hex).join('')
}

/** auth-js `generatePKCEChallenge`: base64url(SHA-256(verifier)), unpadded. */
async function generateChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const binary = Array.from(new Uint8Array(digest), byte => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Start an OAuth sign-in: returns the URL the dialog should navigate to.
 *
 * The verifier is stored before the URL is returned, because the caller's very
 * next act is to leave this page. Anything not persisted by then is gone.
 */
export async function beginOAuth(
  provider: OAuthProvider,
  deps: SignInDeps = {},
): Promise<string> {
  const config = deps.config ?? readSupabaseConfig()
  const redirectTo = deps.redirectTo ?? dialogUrl()

  const verifier = generateVerifier()
  const challenge = await generateChallenge(verifier)
  verifierStore(deps).setItem(VERIFIER_KEY, verifier)

  const params = new URLSearchParams({
    provider,
    redirect_to: redirectTo,
    scopes: OAUTH_SCOPES[provider],
    code_challenge: challenge,
    code_challenge_method: 's256',
  })
  return `${config.url}/auth/v1/authorize?${params.toString()}`
}

/**
 * Redeem the `?code` the provider sent us back with.
 *
 * The verifier is cleared unconditionally. A verifier that outlives its code is
 * a replayable credential sitting in localStorage, and the failure it would
 * paper over — a stale verifier matched against a fresh code — is precisely the
 * confusing "PKCE code verifier not found" class of error.
 */
export async function completeOAuth(
  code: string,
  deps: SignInDeps = {},
): Promise<DialogSession> {
  const config = deps.config ?? readSupabaseConfig()
  const doFetch = deps.fetch ?? globalThis.fetch
  const store = verifierStore(deps)

  const verifier = store.getItem(VERIFIER_KEY)
  store.removeItem(VERIFIER_KEY)

  if (!verifier) {
    throw new SignInError(
      'This window lost track of the sign-in it started. Close it and choose Sign in again.',
    )
  }

  let res: Response
  try {
    res = await doFetch(`${config.url}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    describeAbort(err, 'Supabase')
  }

  let body: TokenResponse
  try {
    body = (await res.json()) as TokenResponse
  } catch {
    throw new SignInError(`Supabase returned an unreadable response (${res.status}).`)
  }

  if (!res.ok || !body.access_token) {
    throw new SignInError(
      body.error_description ||
        body.msg ||
        body.message ||
        body.error ||
        `Could not finish the sign-in (${res.status}).`,
    )
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_at ?? null,
    email: body.user?.email ?? null,
  }
}

/**
 * Resolve `messageParent`, or null if Office never turns up.
 *
 * Polls rather than trusting a single readiness callback. The previous version
 * reached `messageParent` through one optional chain in one callback: if
 * `window.Office` was not populated at that instant, nothing was called and no
 * error was raised. Polling cannot miss the moment, and the deadline turns a
 * no-show into a message instead of a hang.
 */
export async function resolveMessageParent(
  timeoutMs: number = OFFICE_TIMEOUT_MS,
  getOffice: () => OfficeGlobal | null = defaultGetOffice,
): Promise<((message: string) => void) | null> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const office = getOffice()
    if (office) {
      // Modern office.js resolves a promise from a bare onReady(); older builds
      // only take a callback and return undefined. Awaiting undefined is
      // harmless, so this covers both without sniffing versions.
      try {
        await office.onReady?.()
      } catch {
        // A rejected onReady still leaves messageParent worth checking.
      }
      const messageParent = getOffice()?.context?.ui?.messageParent
      if (typeof messageParent === 'function') return messageParent
    }
    if (Date.now() >= deadline) return null
    await sleep(100)
  }
}

/** Turn a timeout into something that names what we were waiting for. */
function describeAbort(err: unknown, what: string): never {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    throw new SignInError(
      `${what} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s. ` +
        'Check that you are online and that the Cornerstone dev server is running.',
    )
  }
  if (err instanceof SignInError) throw err
  throw new SignInError(
    `Could not reach ${what}: ${err instanceof Error ? err.message : String(err)}`,
  )
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  user?: { email?: string | null } | null
  error_description?: string
  error?: string
  msg?: string
  message?: string
}

/**
 * Exchange an email and password for a Supabase session.
 *
 * The password goes straight to Supabase over HTTPS and is never sent to, or
 * stored by, Cornerstone — the same path the browser login page takes.
 */
export async function requestToken(
  email: string,
  password: string,
  deps: SignInDeps = {},
): Promise<DialogSession> {
  const config = deps.config ?? readSupabaseConfig()
  const doFetch = deps.fetch ?? globalThis.fetch

  let res: Response
  try {
    res = await doFetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    describeAbort(err, 'Supabase')
  }

  let body: TokenResponse
  try {
    body = (await res.json()) as TokenResponse
  } catch {
    throw new SignInError(`Supabase returned an unreadable response (${res.status}).`)
  }

  if (!res.ok) {
    // 400 from a password grant is nearly always a wrong email or password.
    // Say so plainly rather than surfacing "invalid_grant" to an attorney.
    if (res.status === 400) {
      throw new SignInError('That email and password did not match. Try again.')
    }
    throw new SignInError(
      body.error_description ||
        body.msg ||
        body.message ||
        body.error ||
        `Sign-in failed (${res.status}).`,
    )
  }

  if (!body.access_token) {
    throw new SignInError('Supabase accepted the sign-in but returned no access token.')
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_at ?? null,
    email: body.user?.email ?? email,
  }
}

export interface ProfileInfo {
  email: string | null
  name: string | null
  role: string | null
}

/**
 * Confirm the account may use the add-in.
 *
 * This is `GET /api/addin/session`, same-origin through the dev proxy — the
 * route the pane already calls on startup. It runs `requireAdmin`, so it *is*
 * the role gate; the dialog deliberately keeps no second copy of the role list
 * to drift out of step with `lib/apiAuth.ts`.
 */
export async function fetchProfile(
  accessToken: string,
  deps: SignInDeps = {},
): Promise<ProfileInfo> {
  const doFetch = deps.fetch ?? globalThis.fetch

  let res: Response
  try {
    res = await doFetch('/api/addin/session', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    describeAbort(err, 'Cornerstone')
  }

  if (res.status === 403) {
    throw new SignInError('This account does not have firm access.')
  }
  if (!res.ok) {
    throw new SignInError(`Cornerstone rejected the sign-in (${res.status}).`)
  }

  return (await res.json()) as ProfileInfo
}

export interface SignInResult {
  session: DialogSession
  profile: ProfileInfo
  /**
   * False when the session is good but Office never appeared, so the token
   * could not be handed back. The dialog offers it for pasting instead of
   * stranding the attorney on a dead end.
   */
  handedOff: boolean
}

/**
 * Credentials in, handed-off session out.
 *
 * Each step reports itself through `onStep` so the dialog can show which one is
 * in flight. That matters more than it looks: this dialog has no console, and
 * for five rounds the only thing anyone could report about it was that it was
 * "stuck" — with no way to tell which wait it was stuck on.
 */
export async function signIn(
  email: string,
  password: string,
  deps: SignInDeps = {},
): Promise<SignInResult> {
  const step = deps.onStep ?? (() => {})

  const run = async <T>(id: StepId, work: () => Promise<T>): Promise<T> => {
    step(id, 'running')
    try {
      const value = await work()
      step(id, 'done')
      return value
    } catch (err) {
      step(id, 'failed')
      throw err
    }
  }

  const session = await run('credentials', () => requestToken(email, password, deps))
  return finishSignIn(session, deps)
}

/**
 * Everything after a session exists, whichever door produced it.
 *
 * Shared by the password path and the OAuth return, so the role gate and the
 * handoff cannot drift apart between the two. `credentials` is already done by
 * the time this runs; it picks up at `access`.
 */
export async function finishSignIn(
  session: DialogSession,
  deps: SignInDeps = {},
): Promise<SignInResult> {
  const step = deps.onStep ?? (() => {})

  step('access', 'running')
  let profile: ProfileInfo
  try {
    profile = await fetchProfile(session.accessToken, deps)
    step('access', 'done')
  } catch (err) {
    step('access', 'failed')
    throw err
  }

  // A missing Office is a failed handoff but a successful sign-in, so this
  // reports 'failed' while the call still resolves and the caller falls back to
  // showing the token.
  step('handoff', 'running')
  const messageParent = await resolveMessageParent(
    deps.officeTimeoutMs ?? OFFICE_TIMEOUT_MS,
    deps.getOffice ?? defaultGetOffice,
  )
  if (!messageParent) {
    step('handoff', 'failed')
    return { session, profile, handedOff: false }
  }

  messageParent(
    JSON.stringify({
      type: HANDOFF_TYPE,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      email: profile.email ?? session.email,
    }),
  )
  step('handoff', 'done')
  return { session, profile, handedOff: true }
}

/**
 * The OAuth return leg: redeem the code, then the same tail as a password login.
 *
 * `credentials` covers the token exchange here. The label still fits — it is
 * the step that turns something the attorney presented into a session.
 */
export async function completeOAuthSignIn(
  code: string,
  deps: SignInDeps = {},
): Promise<SignInResult> {
  const step = deps.onStep ?? (() => {})

  step('credentials', 'running')
  let session: DialogSession
  try {
    session = await completeOAuth(code, deps)
    step('credentials', 'done')
  } catch (err) {
    step('credentials', 'failed')
    throw err
  }

  return finishSignIn(session, deps)
}
