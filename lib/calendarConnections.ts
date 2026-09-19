import { getAdminClient } from '@/lib/supabaseAdmin'

export type CalendarProvider = 'google'

export interface CalendarConnection {
  id: string
  user_id: string
  provider: CalendarProvider
  access_token: string
  refresh_token: string | null
  expires_at: string
  scopes: string | null
  email: string | null
  updated_at: string
  created_at: string
}

export interface StoreCalendarConnectionInput {
  userId: string
  provider: CalendarProvider
  access_token: string
  refresh_token: string | null
  expires_at: string
  email?: string | null
  scopes?: string | null
}

export async function getStoredCalendarConnection(
  userId: string,
  provider: CalendarProvider = 'google',
): Promise<CalendarConnection | null> {
  const { data } = await getAdminClient()
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  return data as CalendarConnection | null
}

/**
 * Firm-wide fallback: the most recently refreshed connection for a provider.
 *
 * The firm is a single practitioner, so "whose connection" is not a question
 * worth asking at every call site.
 */
export async function getAnyConnectionForProvider(
  provider: CalendarProvider,
): Promise<CalendarConnection | null> {
  const { data } = await getAdminClient()
    .from('calendar_connections')
    .select('*')
    .eq('provider', provider)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as CalendarConnection | null
}

export async function storeCalendarConnection(
  input: StoreCalendarConnectionInput,
): Promise<void> {
  await getAdminClient()
    .from('calendar_connections')
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        access_token: input.access_token,
        refresh_token: input.refresh_token,
        expires_at: input.expires_at,
        email: input.email ?? null,
        scopes: input.scopes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    )
}

export async function deleteCalendarConnection(
  userId: string,
  provider: CalendarProvider = 'google',
): Promise<void> {
  await getAdminClient()
    .from('calendar_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
}
