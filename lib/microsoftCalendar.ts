import { getStoredCalendarConnection, storeCalendarConnection } from '@/lib/calendarConnections'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const MICROSOFT_GRAPH_TIMEOUT_MS = 15_000
const AZURE_SECRET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MICROSOFT_SECRET_ID_MESSAGE =
  'Microsoft Calendar client secret is set to an Azure secret ID. Copy the secret Value from Azure, not the Secret ID.'

const MICROSOFT_INVALID_SECRET_MESSAGE =
  'Microsoft Calendar client secret is invalid. Copy the secret Value from Azure, not the Secret ID, update the hosting environment variable, and redeploy.'

const SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'User.Read',
  'Calendars.ReadWrite',
  'Mail.Send',
  'Mail.Read',
  'Files.ReadWrite.All',
] as const

export const REQUIRED_MAIL_SCOPE = 'Mail.Send'
export const REQUIRED_MAIL_READ_SCOPE = 'Mail.Read'
export const REQUIRED_FILES_SCOPE = 'Files.ReadWrite.All'

export function hasFilesScope(scope: string | null | undefined): boolean {
  return scopeIncludes(scope, REQUIRED_FILES_SCOPE)
}

function scopeIncludes(scope: string | null | undefined, target: string): boolean {
  if (!scope) return false
  return scope.toLowerCase().split(/[\s,]+/).includes(target.toLowerCase())
}

export function hasMailSendScope(scope: string | null | undefined): boolean {
  return scopeIncludes(scope, REQUIRED_MAIL_SCOPE)
}

export function hasMailReadScope(scope: string | null | undefined): boolean {
  return scopeIncludes(scope, REQUIRED_MAIL_READ_SCOPE)
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
  return getMicrosoftCalendarConfigIssue() === null
}

export function getMicrosoftCalendarConfigIssue(): string | null {
  if (!process.env.MICROSOFT_GRAPH_CLIENT_ID) return 'MICROSOFT_GRAPH_CLIENT_ID is not configured'
  if (!process.env.MICROSOFT_GRAPH_CLIENT_SECRET) return 'MICROSOFT_GRAPH_CLIENT_SECRET is not configured'
  if (AZURE_SECRET_ID_RE.test(process.env.MICROSOFT_GRAPH_CLIENT_SECRET.trim())) {
    return MICROSOFT_SECRET_ID_MESSAGE
  }
  if (!process.env.MICROSOFT_GRAPH_REDIRECT_URI) return 'MICROSOFT_GRAPH_REDIRECT_URI is not configured'
  return null
}

export function toMicrosoftCalendarDisplayError(error: string): string {
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
  token_type?: string
  id_token?: string
}

async function microsoftFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(MICROSOFT_GRAPH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('Microsoft Calendar request timed out')
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
  const r = await microsoftFetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await r.json()
  if (!r.ok) throw new Error(toMicrosoftCalendarDisplayError(json.error_description || json.error || 'Token exchange failed'))
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
  const r = await microsoftFetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await r.json()
  if (!r.ok) throw new Error(toMicrosoftCalendarDisplayError(json.error_description || json.error || 'Token refresh failed'))
  return json as TokenResponse
}

// Returns a valid Graph access token, refreshing if needed.
export async function getAccessToken(): Promise<string> {
  const conn = await getStoredCalendarConnection('microsoft')
  if (!conn) throw new Error('Microsoft Calendar not connected')

  const expiresAt = new Date(conn.expires_at).getTime()
  if (Date.now() < expiresAt - 60_000) return conn.access_token

  if (!conn.refresh_token) {
    throw new Error('Token expired and no refresh token available. Please reconnect Microsoft Calendar.')
  }

  const refreshed = await refreshToken(conn.refresh_token)
  const newExpires = new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString()
  await storeCalendarConnection({
    provider: 'microsoft',
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? conn.refresh_token,
    expires_at: newExpires,
    account_email: conn.account_email,
    scope: refreshed.scope ?? conn.scope,
  })
  return refreshed.access_token
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await microsoftFetch(`${GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const j = await r.json() as { mail?: string; userPrincipalName?: string }
    return j.mail || j.userPrincipalName || null
  } catch {
    return null
  }
}

async function graphFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const r = await microsoftFetch(`${GRAPH_BASE}${path}`, { ...init, headers })
  return r
}

/* ─── Types ─────────────────────────────────────────────────────────────── */

export interface GraphCalendar {
  id: string
  name: string
  isDefaultCalendar?: boolean
  hexColor?: string
  canEdit?: boolean
  owner?: { name?: string; address?: string }
}

export interface GraphEvent {
  id: string
  subject?: string | null
  bodyPreview?: string | null
  body?: { contentType?: string; content?: string | null } | null
  location?: { displayName?: string | null } | null
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  isAllDay?: boolean
  attendees?: Array<{
    emailAddress: { address: string; name?: string | null }
    status?: { response?: string }
    type?: string
  }>
  webLink?: string
  organizer?: { emailAddress: { address: string; name?: string | null } }
}

export interface GraphSubscription {
  id: string
  resource: string
  changeType: string
  notificationUrl: string
  expirationDateTime: string
  clientState?: string | null
}

/* ─── Calendar list / Event CRUD ────────────────────────────────────────── */

export async function listCalendars(): Promise<GraphCalendar[]> {
  const r = await graphFetch('/me/calendars?$top=100')
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to list calendars')
  return (json.value ?? []) as GraphCalendar[]
}

export async function listEvents(opts: {
  calendarId: string
  timeMin: string
  timeMax?: string
  maxResults?: number
}): Promise<GraphEvent[]> {
  const start = new Date(opts.timeMin).toISOString()
  const end = (opts.timeMax ? new Date(opts.timeMax) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)).toISOString()
  const top = Math.min(opts.maxResults ?? 100, 250)

  // calendarView gives expanded recurrences sorted by start time.
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $top: String(top),
    $orderby: 'start/dateTime',
  })
  // Use the special 'primary'/default route when caller asked for it.
  const path = opts.calendarId === 'primary'
    ? `/me/calendarView?${params.toString()}`
    : `/me/calendars/${encodeURIComponent(opts.calendarId)}/calendarView?${params.toString()}`

  const r = await graphFetch(path, {
    headers: { Prefer: 'outlook.timezone="UTC"' },
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to list events')
  return (json.value ?? []) as GraphEvent[]
}

export interface CreateEventInput {
  calendarId?: string
  summary: string
  description?: string
  location?: string
  start: string  // local ISO 'YYYY-MM-DDTHH:mm:ss'
  end: string    // local ISO
  timeZone: string
  attendeeEmail?: string
  sendNotifications?: boolean
}

export async function createEvent(input: CreateEventInput): Promise<GraphEvent> {
  const body = {
    subject: input.summary,
    body: input.description ? { contentType: 'text', content: input.description } : undefined,
    location: input.location ? { displayName: input.location } : undefined,
    start: { dateTime: input.start, timeZone: input.timeZone },
    end:   { dateTime: input.end,   timeZone: input.timeZone },
    attendees: input.attendeeEmail
      ? [{ emailAddress: { address: input.attendeeEmail }, type: 'required' }]
      : [],
    isReminderOn: false,
  }

  // Send vs draft (no invite). Microsoft Graph posts to events directly; the
  // 'sendNotifications' flag is implicit (any attendee triggers an invite).
  // To suppress invites, post as draft + cancel send: simplest approach is to
  // omit attendees when sendNotifications is false.
  if (!input.sendNotifications && body.attendees.length > 0) {
    body.attendees = []
  }

  const path = input.calendarId && input.calendarId !== 'primary'
    ? `/me/calendars/${encodeURIComponent(input.calendarId)}/events`
    : '/me/events'

  const r = await graphFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to create event')
  return json as GraphEvent
}

export async function fetchMicrosoftEvent(eventId: string): Promise<GraphEvent> {
  const r = await graphFetch(`/me/events/${encodeURIComponent(eventId)}`, {
    headers: { Prefer: 'outlook.timezone="UTC"' },
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to fetch event')
  return json as GraphEvent
}

export interface CreateSubscriptionInput {
  changeType: string
  notificationUrl: string
  resource: string
  expirationDateTime: string
  clientState: string
}

export async function createMicrosoftCalendarSubscription(
  input: CreateSubscriptionInput,
): Promise<GraphSubscription> {
  const r = await graphFetch('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: input.changeType,
      notificationUrl: input.notificationUrl,
      resource: input.resource,
      expirationDateTime: input.expirationDateTime,
      clientState: input.clientState,
      latestSupportedTlsVersion: 'v1_2',
    }),
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to create Microsoft Calendar subscription')
  return json as GraphSubscription
}

export async function renewMicrosoftCalendarSubscription(input: {
  subscriptionId: string
  expirationDateTime: string
}): Promise<GraphSubscription> {
  const r = await graphFetch(`/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: input.expirationDateTime }),
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to renew Microsoft Calendar subscription')
  return json as GraphSubscription
}

export interface PatchEventInput {
  eventId: string
  summary?: string
  description?: string
  location?: string
  start?: string
  end?: string
  timeZone: string
  attendeeEmail?: string
  sendNotifications?: boolean
}

export async function patchEvent(input: PatchEventInput): Promise<GraphEvent> {
  const body: Record<string, unknown> = {}
  if (input.summary !== undefined) body.subject = input.summary
  if (input.description !== undefined) {
    body.body = { contentType: 'text', content: input.description }
  }
  if (input.location !== undefined) {
    body.location = { displayName: input.location }
  }
  if (input.start !== undefined) {
    body.start = { dateTime: input.start, timeZone: input.timeZone }
  }
  if (input.end !== undefined) {
    body.end = { dateTime: input.end, timeZone: input.timeZone }
  }
  if (input.attendeeEmail !== undefined) {
    body.attendees = input.attendeeEmail
      ? [{ emailAddress: { address: input.attendeeEmail }, type: 'required' }]
      : []
  }

  const r = await graphFetch(`/me/events/${encodeURIComponent(input.eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message || 'Failed to update event')
  return json as GraphEvent
}

export async function deleteEvent(eventId: string): Promise<void> {
  const r = await graphFetch(`/me/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
  if (!r.ok && r.status !== 204) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.error?.message || 'Failed to delete event')
  }
}
