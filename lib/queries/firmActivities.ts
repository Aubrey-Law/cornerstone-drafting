import 'server-only'
import { dateInstant, nextDateKey } from '@/lib/calendarAvailability'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { requireStaffPage } from '@/lib/review/staff'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { ACTIVITY_PAGE_SIZE, activityCursor, type ActivityFilters, type ActivityRow } from '@/lib/activities/feed'

// Local view contract until generated database types are refreshed after migration.
type ActivityDatabase = Omit<GeneratedDatabase, 'public'> & { public: Omit<GeneratedDatabase['public'], 'Views'> & {
  Views: GeneratedDatabase['public']['Views'] & { v_firm_activity: { Row: ActivityRow; Relationships: [] } }
} }
export async function fetchFirmActivities(filters: ActivityFilters) {
  await requireStaffPage()
  const client = getAdminClient() as unknown as SupabaseClient<ActivityDatabase>
  let query = client.from('v_firm_activity').select('*').order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(ACTIVITY_PAGE_SIZE + 1)
  if (filters.source) query = query.eq('source', filters.source)
  if (filters.record) query = query.or(`matter_id.eq.${filters.record},lead_id.eq.${filters.record}`)
  if (filters.person) query = query.contains('person_ids', [filters.person])
  if (filters.actor) query = query.eq('actor_id', filters.actor)
  if (filters.event) query = query.eq('event_type', filters.event)
  if (filters.from) query = query.gte('occurred_at', new Date(dateInstant(filters.from, FIRM_TIMEZONE)).toISOString())
  if (filters.to) {
    const end = new Date(dateInstant(nextDateKey(filters.to), FIRM_TIMEZONE))
    query = query.lt('occurred_at', end.toISOString())
  }
  if (filters.cursor) query = query.or(`occurred_at.lt.${filters.cursor.at},and(occurred_at.eq.${filters.cursor.at},id.lt.${filters.cursor.id})`)
  const { data, error } = await query
  if (error) return { rows: [] as ActivityRow[], next: null, error: 'Activity history could not be loaded. Check that the firm activity migration has been applied, then retry.' }
  const rows = (data ?? []).slice(0, ACTIVITY_PAGE_SIZE)
  return { rows, next: (data?.length ?? 0) > ACTIVITY_PAGE_SIZE ? activityCursor(rows[rows.length - 1]) : null, error: null }
}
