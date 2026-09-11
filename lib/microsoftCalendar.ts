import {
  getAnyMicrosoftConnection,
  getStoredCalendarConnection,
  storeCalendarConnection,
  type CalendarConnection,
} from '@/lib/calendarConnections'

/**
 * Token handling for the retired Microsoft 365 connection.
 *
 * The firm's calendar and mailbox are Google. This file exists only to keep an
 * already-stored Outlook connection usable, so appointments booked before the
 * switchover can still be cancelled and moved in the calendar that holds them
 * (see `lib/appointments/legacyOutlookEvents.ts`). There is deliberately no
 * consent URL and no code exchange: nothing can connect Outlook again, and a
 * half-alive path back to Microsoft would be worse than none.
 *
 * `MICROSOFT_GRAPH_CLIENT_ID` / `_SECRET` / `_TENANT_ID` are still read, purely
 * to refresh the existing token. Once no appointment carries a future
 * `microsoft_event_id`, this file and those variables can go.
 */

const MICROSOFT_GRAPH_TIMEOUT_MS = 15_000
const AZURE_SECRET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MICROSOFT_SECRET_ID_MESSAGE =
  'Microsoft client secret is set to an Azure secret ID. Copy the secret Value from Azure, not the Secret ID.'

/** The scopes the stored connection was granted; a refresh must ask for the same set. */
const SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'User.Read',
  'Calendars.ReadWrite',
] as const

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
    throw new Error(json.error_description || json.error || 'Token refresh failed')
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
    throw new Error(
      'The legacy Outlook token expired and cannot be renewed. Cancel or move the event in Outlook directly.',
    )
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

export async function getMicrosoftConnectionForUser(
  userId?: string | null,
): Promise<CalendarConnection | null> {
  return resolveConnection(userId)
}
