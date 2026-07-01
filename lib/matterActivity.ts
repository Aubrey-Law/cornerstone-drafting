import { supabase } from '@/lib/supabaseClient'
import type { ActivityEventType, MatterActivity } from '@/types/database'

interface LogOptions {
  detail?: string
  metadata?: Record<string, unknown>
}

export async function logMatterActivity(
  matterId: string,
  event_type: ActivityEventType,
  title: string,
  options?: LogOptions,
): Promise<MatterActivity | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    const row = {
      matter_id: matterId,
      event_type,
      title,
      detail: options?.detail ?? null,
      metadata: options?.metadata ?? null,
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      actor_name: (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null,
    }
    const { data, error } = await supabase.from('matter_activity').insert(row).select('*').single()
    if (error) return null
    return data as MatterActivity
  } catch {
    // Best-effort: never block the user-facing action.
    return null
  }
}
