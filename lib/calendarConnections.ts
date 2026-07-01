import { getAdminClient } from '@/lib/supabaseAdmin'

export type CalendarProvider = 'google' | 'microsoft'

export interface CalendarConnection {
  id: string
  provider: CalendarProvider
  access_token: string
  refresh_token: string | null
  expires_at: string
  account_email: string | null
  scope: string | null
  updated_at: string
  created_at: string
}

export interface StoreCalendarConnectionInput {
  provider: CalendarProvider
  access_token: string
  refresh_token: string | null
  expires_at: string
  account_email?: string | null
  scope?: string | null
}

export async function getStoredCalendarConnection(provider: CalendarProvider): Promise<CalendarConnection | null> {
  const { data } = await getAdminClient()
    .from('calendar_connections')
    .select('*')
    .eq('id', provider)
    .maybeSingle()
  return data as CalendarConnection | null
}

// Lightweight in-process cache for hot paths that only need to know whether a
// connection exists and what scopes it has (e.g. the admin email kill-switch
// banner rendered on every admin request). Mirrors the 30s TTL pattern in
// lib/email/settings.ts so banner state stays fresh without a DB hit per render.
const CONN_CACHE_MS = 30_000
const connCache = new Map<CalendarProvider, { at: number; conn: CalendarConnection | null }>()

export async function getStoredCalendarConnectionCached(provider: CalendarProvider): Promise<CalendarConnection | null> {
  const hit = connCache.get(provider)
  if (hit && Date.now() - hit.at < CONN_CACHE_MS) return hit.conn
  const conn = await getStoredCalendarConnection(provider)
  connCache.set(provider, { at: Date.now(), conn })
  return conn
}

export function clearCalendarConnectionCache(provider?: CalendarProvider) {
  if (provider) connCache.delete(provider)
  else connCache.clear()
}

export async function listCalendarConnections(): Promise<CalendarConnection[]> {
  const { data } = await getAdminClient()
    .from('calendar_connections')
    .select('*')
    .order('provider', { ascending: true })
  return (data ?? []) as CalendarConnection[]
}

export async function storeCalendarConnection(input: StoreCalendarConnectionInput): Promise<void> {
  await getAdminClient()
    .from('calendar_connections')
    .upsert({
      id: input.provider,
      provider: input.provider,
      access_token: input.access_token,
      refresh_token: input.refresh_token,
      expires_at: input.expires_at,
      account_email: input.account_email ?? null,
      scope: input.scope ?? null,
      updated_at: new Date().toISOString(),
    })
  clearCalendarConnectionCache(input.provider)
}

export async function deleteCalendarConnection(provider: CalendarProvider): Promise<void> {
  await getAdminClient()
    .from('calendar_connections')
    .delete()
    .eq('id', provider)
  clearCalendarConnectionCache(provider)
}
