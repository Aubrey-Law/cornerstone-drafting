import {
  getAnyMicrosoftConnection,
  getStoredCalendarConnection,
  storeCalendarConnection,
  type CalendarConnection,
} from '@/lib/calendarConnections'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const MICROSOFT_GRAPH_TIMEOUT_MS = 15_000
const AZURE_SECRET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MICROSOFT_SECRET_ID_MESSAGE =
  'Microsoft client secret is set to an Azure secret ID. Copy the secret Value from Azure, not the Secret ID.'

const MICROSOFT_INVALID_SECRET_MESSAGE =
  'Microsoft client secret is invalid. Copy the secret Value from Azure, not the Secret ID, update the hosting environment variable, and redeploy.'

const SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'User.Read',
  'Calendars.ReadWrite',
  'Mail.Send',
  'Mail.Read',
] as const

export const REQUIRED_MAIL_SCOPE = 'Mail.Send'

function scopeIncludes(scope: string | null | undefined, target: string): boolean {
  if (!scope) return false
  return scope.toLowerCase().split(/[\s,]+/).includes(target.toLowerCase())
}

export function hasMailSendScope(scope: string | null | undefined): boolean {
  return scopeIncludes(scope, REQUIRED_MAIL_SCOPE)
}

function tenant() {
  return process.env.MICROSOFT_GRAPH_TENANT_ID || 'common'
}

function clientId() {
  const id = process.env.MICROSOFT_GRAPH_CLIENT_ID
  if (!id) throw new Error('MICROSOFT_GRAPH_CLIENT_ID is not configured')
  return id
}

function clientSecret() {
  const s = process.env.MICROSOFT_GRAPH_CLIENT_SECRET
  if (!s) throw new Error('MICROSOFT_GRAPH_CLIENT_SECRET is not configured')
  if (AZURE_SECRET_ID_RE.test(s.trim())) throw new Error(MICROSOFT_SECRET_ID_MESSAGE)
  return s
}

function redirectUri() {
  const u = process.env.MICROSOFT_GRAPH_REDIRECT_URI
  if (!u) throw new Error('MICROSOFT_GRAPH_REDIRECT_URI is not configured')
  return u
}

export function isMicrosoftConfigured(): boolean {
  return getMicrosoftConfigIssue() === null
}

export function getMicrosoftConfigIssue(): string | null {
  if (!process.env.MICROSOFT_GRAPH_CLIENT_ID) return 'MICROSOFT_GRAPH_CLIENT_ID is not configured'
  if (!process.env.MICROSOFT_GRAPH_CLIENT_SECRET) {
    return 'MICROSOFT_GRAPH_CLIENT_SECRET is not configured'
  }
  if (AZURE_SECRET_ID_RE.test(process.env.MICROSOFT_GRAPH_CLIENT_SECRET.trim())) {
    return MICROSOFT_SECRET_ID_MESSAGE
  }
  if (!process.env.MICROSOFT_GRAPH_REDIRECT_URI) {
    return 'MICROSOFT_GRAPH_REDIRECT_URI is not configured'
  }
  return null
}

export function toMicrosoftDisplayError(error: string): string {
  if (/AADSTS7000215|invalid client secret|secret value, not the secret ID/i.test(error)) {
    return MICROSOFT_INVALID_SECRET_MESSAGE
  }
  return error
}

export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES.join(' '),
    prompt: 'select_account',
  })
  if (state) params.set('state', state)
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function microsoftFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(MICROSOFT_GRAPH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('Microsoft Graph request timed out')
    }
    throw err
  }
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  })
  const r = await microsoftFetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
  const json = await r.json()
  if (!r.ok) {
    throw new Error(
      toMicrosoftDisplayError(json.error_description || json.error || 'Token exchange failed'),
    )
  }
  return json as TokenResponse
}

async function refreshToken(refresh: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
    refresh_token: refresh,
    scope: SCOPES.join(' '),
  })
  const r = await microsoftFetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
  const json = await r.json()
  if (!r.ok) {
    throw new Error(
      toMicrosoftDisplayError(json.error_description || json.error || 'Token refresh failed'),
    )
  }
  return json as TokenResponse
}

async function resolveConnection(userId?: string | null): Promise<CalendarConnection | null> {
  if (userId) {
    const conn = await getStoredCalendarConnection(userId, 'microsoft')
    if (conn) return conn
  }
  return getAnyMicrosoftConnection()
}

/** Returns a valid Graph access token, refreshing if needed. */
export async function getAccessToken(userId?: string | null): Promise<string> {
  const conn = await resolveConnection(userId)
  if (!conn) throw new Error('Microsoft Outlook is not connected')

  const expiresAt = new Date(conn.expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return conn.access_token

  if (!conn.refresh_token) {
    throw new Error('Token expired and no refresh token available. Please reconnect Outlook.')
  }

  const refreshed = await refreshToken(conn.refresh_token)
  const newExpires = new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString()
  await storeCalendarConnection({
    userId: conn.user_id,
    provider: 'microsoft',
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? conn.refresh_token,
    expires_at: newExpires,
    email: conn.email,
    scopes: refreshed.scope ?? conn.scopes,
  })
  return refreshed.access_token
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await microsoftFetch(`${GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const j = (await r.json()) as { mail?: string; userPrincipalName?: string }
    return j.mail || j.userPrincipalName || null
  } catch {
    return null
  }
}

export async function getMicrosoftConnectionForUser(
  userId?: string | null,
): Promise<CalendarConnection | null> {
  return resolveConnection(userId)
}
