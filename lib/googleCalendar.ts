import {
  getAnyConnectionForProvider,
  getStoredCalendarConnection,
  storeCalendarConnection,
  type CalendarConnection,
} from '@/lib/calendarConnections'

/**
 * Google OAuth for the firm's calendar and mailbox.
 *
 * One connection covers both: the same consent that lets Cornerstone write
 * appointments also lets it send matter email, so the attorney authorises once
 * and the app never has to explain which half of Google it is missing.
 */

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_TIMEOUT_MS = 15_000

export const REQUIRED_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'
export const REQUIRED_GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

/**
 * `gmail.send` is send-only by design. Cornerstone never reads the mailbox, and
 * the broader `gmail.modify`/`mail.google.com` scopes would put every message
 * the attorney has ever received inside the app's blast radius for no feature.
 */
const SCOPES = [
  'openid',
  'email',
  'profile',
  REQUIRED_CALENDAR_SCOPE,
  REQUIRED_GMAIL_SCOPE,
] as const

function scopeIncludes(scope: string | null | undefined, target: string): boolean {
  if (!scope) return false
  return scope.toLowerCase().split(/[\s,]+/).includes(target.toLowerCase())
}

export function hasCalendarScope(scope: string | null | undefined): boolean {
  return scopeIncludes(scope, REQUIRED_CALENDAR_SCOPE)
}

/**
 * Whether the stored connection can send mail.
 *
 * A connection made before Gmail was wired in carries only the calendar scope
 * and Google will refuse the send, so this is checked before offering Gmail as
 * a provider rather than after a client email silently fails.
 */
export function hasGmailSendScope(scope: string | null | undefined): boolean {
  return scopeIncludes(scope, REQUIRED_GMAIL_SCOPE)
}

function clientId() {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_CLIENT_ID is not configured')
  return id
}

function clientSecret() {
  const s = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  if (!s) throw new Error('GOOGLE_CALENDAR_CLIENT_SECRET is not configured')
  return s
}

function redirectUri() {
  const u = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  if (!u) throw new Error('GOOGLE_CALENDAR_REDIRECT_URI is not configured')
  return u
}

export function isGoogleConfigured(): boolean {
  return getGoogleConfigIssue() === null
}

export function getGoogleConfigIssue(): string | null {
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) return 'GOOGLE_CALENDAR_CLIENT_ID is not configured'
  if (!process.env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    return 'GOOGLE_CALENDAR_CLIENT_SECRET is not configured'
  }
  if (!process.env.GOOGLE_CALENDAR_REDIRECT_URI) {
    return 'GOOGLE_CALENDAR_REDIRECT_URI is not configured'
  }
  return null
}

export function toGoogleDisplayError(error: string): string {
  if (/redirect_uri_mismatch/i.test(error)) {
    return 'Google rejected the redirect URI. The value in GOOGLE_CALENDAR_REDIRECT_URI must match an Authorised redirect URI on the OAuth client exactly, including scheme and trailing slash.'
  }
  if (/invalid_client/i.test(error)) {
    return 'Google rejected the client credentials. Check GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET against the OAuth client in the Google Cloud console.'
  }
  if (/access_denied/i.test(error)) {
    return 'Consent was declined, so Cornerstone has no access to the calendar.'
  }
  return error
}

/**
 * The consent URL.
 *
 * `access_type=offline` and `prompt=consent` are both load-bearing and neither
 * is optional here. Without `access_type=offline` Google issues no refresh
 * token at all, and an hour later the connection is dead with nothing to renew
 * it. Without `prompt=consent` Google returns a refresh token only on a
 * account's *first* ever consent — so a reconnect after any earlier grant
 * silently yields an access token with no refresh token, which looks like a
 * successful connection until it expires. Forcing consent costs one extra click
 * and removes a failure that is invisible for an hour.
 */
export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  if (state) params.set('state', state)
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function googleFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('Google Calendar request timed out')
    }
    throw err
  }
}

async function postToken(body: URLSearchParams, failure: string): Promise<TokenResponse> {
  const r = await googleFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await r.json()
  if (!r.ok) {
    throw new Error(toGoogleDisplayError(json.error_description || json.error || failure))
  }
  return json as TokenResponse
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    'Token exchange failed',
  )
}

async function refreshToken(refresh: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
    'Token refresh failed',
  )
}

async function resolveConnection(userId?: string | null): Promise<CalendarConnection | null> {
  if (userId) {
    const conn = await getStoredCalendarConnection(userId, 'google')
    if (conn) return conn
  }
  return getAnyConnectionForProvider('google')
}

/** Returns a valid Google access token, refreshing if needed. */
export async function getAccessToken(userId?: string | null): Promise<string> {
  const conn = await resolveConnection(userId)
  if (!conn) throw new Error('Google Calendar is not connected')

  const expiresAt = new Date(conn.expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return conn.access_token

  if (!conn.refresh_token) {
    throw new Error(
      'Token expired and no refresh token available. Please reconnect Google Calendar.',
    )
  }

  const refreshed = await refreshToken(conn.refresh_token)
  const newExpires = new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString()
  await storeCalendarConnection({
    userId: conn.user_id,
    provider: 'google',
    access_token: refreshed.access_token,
    // Google does not return a refresh token on a refresh — only on the initial
    // consent. Overwriting with the absent value would discard the only means of
    // renewal and turn every token expiry into a manual reconnect.
    refresh_token: refreshed.refresh_token ?? conn.refresh_token,
    expires_at: newExpires,
    email: conn.email,
    scopes: refreshed.scope ?? conn.scopes,
  })
  return refreshed.access_token
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await googleFetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const j = (await r.json()) as { email?: string }
    return j.email || null
  } catch {
    return null
  }
}

export async function getGoogleConnectionForUser(
  userId?: string | null,
): Promise<CalendarConnection | null> {
  return resolveConnection(userId)
}
