import 'server-only'
import {
  getAnyConnectionForProvider,
  getStoredCalendarConnection,
  storeCalendarConnection,
  type CalendarConnection,
} from '@/lib/calendarConnections'

/**
 * Microsoft 365, for Teams meetings only.
 *
 * The firm's calendar is Google and stays Google: this connection never reads
 * or writes an Outlook calendar. It exists so an appointment can carry a Teams
 * join link instead of a Meet link. Graph creates a standalone online meeting
 * (`/me/onlineMeetings`), and the booking flow puts its join URL on the Google
 * event and in the client's emails.
 *
 * `OnlineMeetings.ReadWrite` is the narrowest scope that does this. It needs a
 * work or school account: Graph refuses online meetings for personal Microsoft
 * accounts, which is why the default tenant is `organizations`, not `common`.
 * A single-tenant registration (the documented setup) must set
 * MICROSOFT_TENANT_ID: Microsoft refuses `organizations` for those (AADSTS50194).
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const MICROSOFT_TIMEOUT_MS = 15_000

export const REQUIRED_TEAMS_SCOPE = 'OnlineMeetings.ReadWrite'
/**
 * Reading a meeting's transcript after the fact, so the meeting follow-up can
 * run from it. Added later than the meeting scope, so a connection made
 * before it lacks it until the attorney reconnects; the sweep says so rather
 * than failing.
 */
export const REQUIRED_TRANSCRIPT_SCOPE = 'OnlineMeetingTranscript.Read.All'

const SCOPES = ['openid', 'email', 'offline_access', 'User.Read', REQUIRED_TEAMS_SCOPE, REQUIRED_TRANSCRIPT_SCOPE] as const

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID?.trim() || 'organizations'
}

function authorityBase(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant())}/oauth2/v2.0`
}

function clientId() {
  const id = process.env.MICROSOFT_CLIENT_ID
  if (!id) throw new Error('MICROSOFT_CLIENT_ID is not configured')
  return id
}

function clientSecret() {
  const s = process.env.MICROSOFT_CLIENT_SECRET
  if (!s) throw new Error('MICROSOFT_CLIENT_SECRET is not configured')
  return s
}

function redirectUri() {
  const u = process.env.MICROSOFT_REDIRECT_URI
  if (!u) throw new Error('MICROSOFT_REDIRECT_URI is not configured')
  return u
}

export function getMicrosoftConfigIssue(): string | null {
  if (!process.env.MICROSOFT_CLIENT_ID) return 'MICROSOFT_CLIENT_ID is not configured'
  if (!process.env.MICROSOFT_CLIENT_SECRET) return 'MICROSOFT_CLIENT_SECRET is not configured'
  if (!process.env.MICROSOFT_REDIRECT_URI) return 'MICROSOFT_REDIRECT_URI is not configured'
  return null
}

export function isMicrosoftConfigured(): boolean {
  return getMicrosoftConfigIssue() === null
}

function hasScope(scope: string | null | undefined, required: string): boolean {
  if (!scope) return false
  const wanted = required.toLowerCase()
  return scope
    .toLowerCase()
    .split(/[\s,]+/)
    .some(s => s === wanted || s.endsWith(`/${wanted}`))
}

export function hasTeamsScope(scope: string | null | undefined): boolean {
  return hasScope(scope, REQUIRED_TEAMS_SCOPE)
}

export function hasTranscriptScope(scope: string | null | undefined): boolean {
  return hasScope(scope, REQUIRED_TRANSCRIPT_SCOPE)
}

export function toMicrosoftDisplayError(error: string): string {
  if (/AADSTS50011/i.test(error) || /redirect_uri/i.test(error)) {
    return 'Microsoft rejected the redirect URI. MICROSOFT_REDIRECT_URI must match a Web redirect URI on the Entra app registration exactly.'
  }
  if (/AADSTS50194/i.test(error)) {
    return 'The Entra app registration is single-tenant, so Microsoft needs the firm\'s tenant. Set MICROSOFT_TENANT_ID to the Directory (tenant) ID from the registration\'s Overview page and redeploy.'
  }
  if (/AADSTS7000215|invalid_client/i.test(error)) {
    return 'Microsoft rejected the client credentials. Check MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET against the Entra app registration.'
  }
  if (/AADSTS65001|consent_required/i.test(error)) {
    return 'The Microsoft 365 tenant has not consented to OnlineMeetings.ReadWrite. An admin must grant consent for the app registration.'
  }
  if (/access_denied/i.test(error)) {
    return 'Consent was declined, so Cornerstone cannot create Teams meetings.'
  }
  return error
}

/**
 * The consent URL. `offline_access` is what makes Microsoft issue a refresh
 * token; without it the connection dies at the first hourly expiry.
 */
export function getMicrosoftAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES.join(' '),
    prompt: 'select_account',
  })
  if (state) params.set('state', state)
  return `${authorityBase()}/authorize?${params.toString()}`
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
      signal: init.signal ?? AbortSignal.timeout(MICROSOFT_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('Microsoft Teams request timed out')
    }
    throw err
  }
}

async function postToken(body: URLSearchParams, failure: string): Promise<TokenResponse> {
  const r = await microsoftFetch(`${authorityBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(toMicrosoftDisplayError(json.error_description || json.error || failure))
  }
  return json as TokenResponse
}

export async function exchangeMicrosoftCode(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      scope: SCOPES.join(' '),
    }),
    'Token exchange failed',
  )
}

async function resolveConnection(userId?: string | null): Promise<CalendarConnection | null> {
  if (userId) {
    const conn = await getStoredCalendarConnection(userId, 'microsoft')
    if (conn) return conn
  }
  return getAnyConnectionForProvider('microsoft')
}

export async function getMicrosoftConnection(
  userId?: string | null,
): Promise<CalendarConnection | null> {
  return resolveConnection(userId)
}

/** A valid Graph access token, refreshing if needed. */
export async function getMicrosoftAccessToken(userId?: string | null): Promise<string> {
  const conn = await resolveConnection(userId)
  if (!conn) throw new Error('Microsoft Teams is not connected')

  const expiresAt = new Date(conn.expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return conn.access_token

  if (!conn.refresh_token) {
    throw new Error('Microsoft token expired and no refresh token is stored. Reconnect Microsoft Teams.')
  }

  const refreshed = await postToken(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      scope: SCOPES.join(' '),
    }),
    'Token refresh failed',
  )
  await storeCalendarConnection({
    userId: conn.user_id,
    provider: 'microsoft',
    access_token: refreshed.access_token,
    // Microsoft rotates the refresh token on every refresh; keep the old one
    // only if a response ever arrives without a replacement.
    refresh_token: refreshed.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString(),
    email: conn.email,
    scopes: refreshed.scope ?? conn.scopes,
  })
  return refreshed.access_token
}

export async function fetchMicrosoftAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await microsoftFetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const j = (await r.json()) as { mail?: string | null; userPrincipalName?: string | null }
    return j.mail || j.userPrincipalName || null
  } catch {
    return null
  }
}

async function graphFailure(r: Response, what: string): Promise<Error> {
  const detail = await r.text().catch(() => '')
  return new Error(`Microsoft Teams ${what} failed (${r.status}): ${detail.slice(0, 300)}`)
}

export interface TeamsMeeting {
  id: string
  joinUrl: string
}

/** Create a Teams meeting for the given window. */
export async function createTeamsMeeting(input: {
  subject: string
  startIso: string
  endIso: string
}): Promise<TeamsMeeting> {
  const token = await getMicrosoftAccessToken()
  const r = await microsoftFetch(`${GRAPH_BASE}/me/onlineMeetings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: input.subject,
      startDateTime: input.startIso,
      endDateTime: input.endIso,
    }),
  })
  if (!r.ok) throw await graphFailure(r, 'meeting create')
  const json = (await r.json().catch(() => ({}))) as { id?: string; joinWebUrl?: string }
  if (!json.id || !json.joinWebUrl) throw new Error('Microsoft Teams meeting create returned no join link')
  return { id: json.id, joinUrl: json.joinWebUrl }
}

/**
 * Move a Teams meeting. The join link keeps working at any time, so this is
 * housekeeping that keeps the meeting's own start and end times accurate.
 */
export async function rescheduleTeamsMeeting(
  meetingId: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const token = await getMicrosoftAccessToken()
  const r = await microsoftFetch(`${GRAPH_BASE}/me/onlineMeetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDateTime: startIso, endDateTime: endIso }),
  })
  if (!r.ok) throw await graphFailure(r, 'meeting reschedule')
}

export async function deleteTeamsMeeting(meetingId: string): Promise<void> {
  const token = await getMicrosoftAccessToken()
  const r = await microsoftFetch(`${GRAPH_BASE}/me/onlineMeetings/${encodeURIComponent(meetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 means it is already gone, which is what a delete asks for.
  if (!r.ok && r.status !== 404) throw await graphFailure(r, 'meeting delete')
}

export interface TeamsTranscriptSummary {
  id: string
  createdAt: string | null
}

/** The transcripts Teams has produced for a meeting, newest first. Empty until the meeting ends and Teams finishes. */
export async function listTeamsMeetingTranscripts(meetingId: string): Promise<TeamsTranscriptSummary[]> {
  const token = await getMicrosoftAccessToken()
  const r = await microsoftFetch(`${GRAPH_BASE}/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  // A meeting Graph no longer knows has no transcript to read.
  if (r.status === 404) return []
  if (!r.ok) throw await graphFailure(r, 'transcript list')
  const json = (await r.json().catch(() => ({}))) as { value?: Array<{ id?: string; createdDateTime?: string }> }
  return (json.value ?? [])
    .filter((row): row is { id: string; createdDateTime?: string } => typeof row.id === 'string')
    .map(row => ({ id: row.id, createdAt: row.createdDateTime ?? null }))
    .sort((a, b) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? 1 : -1))
}

/** One transcript's content as WebVTT text. */
export async function fetchTeamsTranscriptVtt(meetingId: string, transcriptId: string): Promise<string> {
  const token = await getMicrosoftAccessToken()
  const r = await microsoftFetch(
    `${GRAPH_BASE}/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'text/vtt' } },
  )
  if (!r.ok) throw await graphFailure(r, 'transcript content')
  return r.text()
}
